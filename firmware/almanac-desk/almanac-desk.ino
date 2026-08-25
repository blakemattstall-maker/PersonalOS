// Almanac desk companion — Waveshare ESP32-S3-Touch-AMOLED-1.8.
//
// What it does: polls GET /api/desk once a minute and renders the answer —
// the clock, the ember/clear state, the next thing on the calendar with a
// countdown, the brief's lead line, and the current nudge. Tap the nudge to
// resolve it everywhere. Hold the bottom bar (or the side BOOT button) to
// talk: audio goes to POST /api/capture, which transcribes and routes it
// through the whole app, and the reply comes back out of the speaker via
// POST /api/tts as raw WAV — no decoder on this side, just bytes to I2S.
//
// Build notes live in README.md. Pins are verified against Waveshare's own
// sources (pins.h); the display/touch/audio init sequences are lifted from
// the official demos, which is the difference between "should work" and
// "worked on this exact board".

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include "esp_heap_caps.h"
#include "mbedtls/base64.h"
#include "Arduino_GFX_Library.h"
#include "ESP_I2S.h"

#include "pins.h"
#include "theme.h"
#include "tca9554.h"
#include "touch.h"
#include "es8311.h"
#include "secrets.h"


// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

Arduino_DataBus *bus = new Arduino_ESP32QSPI(
  LCD_CS, LCD_SCLK, LCD_SDIO0, LCD_SDIO1, LCD_SDIO2, LCD_SDIO3);

// Concrete panel type, not the Arduino_GFX base: setBrightness() is a
// subclass method on these AMOLED drivers (brightness is a panel command,
// not a backlight pin).
#if AMOLED_V2
// The V2 panel is a CO5300 with a 16-pixel X offset — same glass, shifted RAM.
Arduino_CO5300 *gfx = new Arduino_CO5300(
  bus, GFX_NOT_DEFINED /* RST is on the expander */, 0, LCD_WIDTH, LCD_HEIGHT,
  16 /* col offset 1 */, 0, 0, 0);
#else
Arduino_SH8601 *gfx = new Arduino_SH8601(
  bus, GFX_NOT_DEFINED /* RST is on the expander */, 0, LCD_WIDTH, LCD_HEIGHT);
#endif


// ---------------------------------------------------------------------------
// Audio — one I2S bus to the ES8311, reconfigured per direction.
//
// Recording is 16kHz (what Whisper wants); playback is 24kHz (what OpenAI's
// WAV output is). One rate would be nicer, but transcoding on a
// microcontroller is worse than two begin() calls.
// ---------------------------------------------------------------------------

I2SClass i2s;

es8311_handle_t codec = NULL;

const uint32_t RECORD_RATE = 16000;
const uint32_t PLAYBACK_RATE = 24000;

bool audioConfigure(uint32_t rate) {

  i2s.end();

  i2s.setPins(I2S_BCK_IO, I2S_WS_IO, I2S_DO_IO, I2S_DI_IO, I2S_MCK_IO);

  if (!i2s.begin(I2S_MODE_STD, rate, I2S_DATA_BIT_WIDTH_16BIT,
                 I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH)) {
    Serial.println("[audio] i2s.begin failed");
    return false;
  }

  // The codec derives everything from MCLK = 256 * fs, which the I2S
  // peripheral generates — so it must be retold the rate whenever we switch.
  if (codec && es8311_sample_frequency_config(codec, rate * 256, rate) != ESP_OK) {
    Serial.println("[audio] codec rate change failed");
    return false;
  }

  return true;

}

bool audioInit() {

  pinMode(PA_PIN, OUTPUT);
  digitalWrite(PA_PIN, HIGH);

  if (!audioConfigure(RECORD_RATE)) return false;

  codec = es8311_create(0, ES8311_ADDRRES_0);

  if (!codec) {
    Serial.println("[audio] es8311_create failed");
    return false;
  }

  const es8311_clock_config_t clk = {
    .mclk_inverted = false,
    .sclk_inverted = false,
    .mclk_from_mclk_pin = true,
    .mclk_frequency = RECORD_RATE * 256,
    .sample_frequency = (int)RECORD_RATE
  };

  if (es8311_init(codec, &clk, ES8311_RESOLUTION_16, ES8311_RESOLUTION_16) != ESP_OK) {
    Serial.println("[audio] es8311_init failed");
    return false;
  }

  es8311_sample_frequency_config(codec, RECORD_RATE * 256, RECORD_RATE);
  es8311_microphone_config(codec, false);
  es8311_voice_volume_set(codec, 85, NULL);
  es8311_microphone_gain_set(codec, (es8311_mic_gain_t)3);

  return true;

}


// ---------------------------------------------------------------------------
// What the server said last — everything the screen renders.
// ---------------------------------------------------------------------------

struct DeskState {
  bool valid = false;
  bool calendarOk = false;
  int attentionCount = 0;
  String nudgeId;
  String nudgeMessage;
  String nextTitle;
  String nextAt;
  int nextInMin = -1;
  int remaining = 0;
  bool eveningFree = false;
  String briefLead;
  bool briefUnread = false;
};

DeskState state;

enum Phase { BOOTING, IDLE, LISTENING, THINKING, SPEAKING, OFFLINE };

Phase phase = BOOTING;

// Where the nudge card was last drawn, so a tap can be matched to it.
int nudgeTop = -1, nudgeBottom = -1;

// The hold-to-talk bar at the bottom of the idle screen.
const int TALK_BAR_TOP = LCD_HEIGHT - 56;

unsigned long lastPoll = 0;
unsigned long lastClockDraw = 0;

const unsigned long POLL_MS = 60'000UL;


// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

// Certificate validation is skipped on purpose for v1: this device talks to
// exactly one host we control, and the payloads it receives are a calendar
// and a nudge. Pinning the ISRG root is the follow-up, not a blocker.
bool httpBegin(HTTPClient &http, WiFiClientSecure &client, const String &path) {

  client.setInsecure();

  if (!http.begin(client, String(API_BASE) + path)) return false;

  http.addHeader("x-pos-key", API_KEY);
  http.setTimeout(30'000);

  return true;

}

bool pollDesk() {

  WiFiClientSecure client;
  HTTPClient http;

  if (!httpBegin(http, client, "/api/desk")) return false;

  const int code = http.GET();

  if (code != 200) {
    Serial.printf("[poll] HTTP %d\n", code);
    http.end();
    return false;
  }

  JsonDocument doc;

  const DeserializationError err = deserializeJson(doc, http.getString());

  http.end();

  if (err) {
    Serial.printf("[poll] JSON: %s\n", err.c_str());
    return false;
  }

  state.valid = true;
  state.attentionCount = doc["attention"]["count"] | 0;
  state.nudgeId = String((const char *)(doc["attention"]["nudge"]["id"] | ""));
  state.nudgeMessage = String((const char *)(doc["attention"]["nudge"]["message"] | ""));

  state.calendarOk = !doc["calendar"].isNull();
  state.nextTitle = String((const char *)(doc["calendar"]["next"]["title"] | ""));
  state.nextAt = String((const char *)(doc["calendar"]["next"]["at"] | ""));
  state.nextInMin = doc["calendar"]["next"]["startsInMin"] | -1;
  state.remaining = doc["calendar"]["remaining"] | 0;
  state.eveningFree = doc["calendar"]["eveningFree"] | false;

  state.briefLead = String((const char *)(doc["brief"]["lead"] | ""));
  state.briefUnread = doc["brief"]["unread"] | false;

  return true;

}

void ackNudge(const String &id) {

  WiFiClientSecure client;
  HTTPClient http;

  if (!httpBegin(http, client, "/api/desk")) return;

  http.addHeader("Content-Type", "application/json");

  const int code = http.POST("{\"action\":\"ack\",\"id\":\"" + id + "\"}");

  Serial.printf("[ack] HTTP %d\n", code);

  http.end();

}


// ---------------------------------------------------------------------------
// Rendering — full redraw on state change, clock-only touch-ups in between.
// AMOLED burn-in care: dim at night, and the whole layout shifts a pixel or
// two with the minute so nothing sits still for hours.
// ---------------------------------------------------------------------------

int wobble() {
  struct tm t;
  if (!getLocalTime(&t, 0)) return 0;
  return t.tm_min % 3;
}

// Naive word wrap for the 6x8 built-in font at a given size.
void printWrapped(const String &text, int x, int &y, int size, uint16_t color, int maxLines) {

  const int charW = 6 * size;
  const int lineH = 8 * size + 4;
  const int perLine = (LCD_WIDTH - 2 * x) / charW;

  gfx->setTextSize(size);
  gfx->setTextColor(color);

  int lineStart = 0, lines = 0;

  while (lineStart < (int)text.length() && lines < maxLines) {

    int lineEnd = min((int)text.length(), lineStart + perLine);

    if (lineEnd < (int)text.length()) {
      const int space = text.lastIndexOf(' ', lineEnd);
      if (space > lineStart) lineEnd = space;
    }

    gfx->setCursor(x, y);
    gfx->print(text.substring(lineStart, lineEnd));

    y += lineH;
    lines++;

    lineStart = lineEnd;
    while (lineStart < (int)text.length() && text[lineStart] == ' ') lineStart++;

  }

}

void drawClock(bool full) {

  struct tm t;

  if (!getLocalTime(&t, 0)) return;

  char hhmm[6], date[24];

  // 12-hour, no leading zero — a desk clock, not a log line.
  int h = t.tm_hour % 12; if (h == 0) h = 12;
  snprintf(hhmm, sizeof(hhmm), "%d:%02d", h, t.tm_min);
  strftime(date, sizeof(date), "%a %b %e", &t);

  const int w = wobble();

  if (!full) gfx->fillRect(0, 0, LCD_WIDTH, 92, C_BLACK);

  gfx->setTextSize(9);
  gfx->setTextColor(C_WHITE);
  gfx->setCursor(16 + w, 12 + w);
  gfx->print(hhmm);

  gfx->setTextSize(2);
  gfx->setTextColor(C_INK_SOFT);
  gfx->setCursor(20 + w, 78);
  gfx->print(date);

  // Night: the panel is an OLED in a dorm someone sleeps in.
  gfx->setBrightness(t.tm_hour >= 23 || t.tm_hour < 7 ? 40 : 220);

}

void drawIdle() {

  gfx->fillScreen(C_BLACK);

  drawClock(true);

  int y = 100;

  // The ember rule, physical: orange exists on this screen only when
  // something is waiting. A clear queue is a quiet moss line, not a trophy.
  if (state.attentionCount > 0) {
    gfx->fillRoundRect(16, y, LCD_WIDTH - 32, 44, 8, C_EMBER);
    gfx->setTextSize(3);
    gfx->setTextColor(C_BLACK);
    gfx->setCursor(28, y + 11);
    gfx->printf("%d waiting", state.attentionCount);
  } else {
    gfx->drawRoundRect(16, y, LCD_WIDTH - 32, 44, 8, C_MOSS);
    gfx->setTextSize(3);
    gfx->setTextColor(C_MOSS);
    gfx->setCursor(28, y + 11);
    gfx->print("clear");
  }

  y += 62;

  if (!state.calendarOk) {

    printWrapped("calendar unreachable", 20, y, 2, C_INK_SOFT, 1);

  } else if (state.nextTitle.length()) {

    gfx->setTextSize(2);
    gfx->setTextColor(C_INK_SOFT);
    gfx->setCursor(20, y);
    gfx->print("NEXT");
    y += 26;

    printWrapped(state.nextTitle, 20, y, 3, C_WHITE, 2);

    gfx->setTextSize(2);
    gfx->setTextColor(C_TIDE);
    gfx->setCursor(20, y + 2);
    if (state.nextInMin >= 0 && state.nextInMin < 600) {
      gfx->printf("in %d min", state.nextInMin);
      gfx->setTextColor(C_INK_SOFT);
      gfx->printf("  %s", state.nextAt.c_str());
    } else {
      gfx->printf("%s", state.nextAt.c_str());
    }
    y += 30;

  } else {

    String done = String("done for today") + (state.eveningFree ? " - evening free" : "");
    printWrapped(done, 20, y, 2, C_MOSS, 1);

  }

  y += 10;

  if (state.briefLead.length()) {
    printWrapped(state.briefLead, 20, y, 2, C_INK_SOFT, 4);
  }

  // The nudge card. Bordered ember because it is, definitionally, the thing
  // waiting on him. Tapping it resolves it everywhere.
  if (state.nudgeMessage.length()) {

    nudgeTop = max(y + 6, TALK_BAR_TOP - 132);

    gfx->drawRoundRect(12, nudgeTop, LCD_WIDTH - 24, TALK_BAR_TOP - nudgeTop - 10, 8, C_EMBER);

    int ny = nudgeTop + 12;
    printWrapped(state.nudgeMessage, 24, ny, 2, C_WHITE, 4);

    gfx->setTextSize(1);
    gfx->setTextColor(C_INK_SOFT);
    gfx->setCursor(24, TALK_BAR_TOP - 26);
    gfx->print("tap to resolve");

    nudgeBottom = TALK_BAR_TOP - 10;

  } else {
    nudgeTop = nudgeBottom = -1;
  }

  gfx->drawFastHLine(0, TALK_BAR_TOP, LCD_WIDTH, C_LINE);
  gfx->setTextSize(2);
  gfx->setTextColor(C_INK_SOFT);
  gfx->setCursor(20, TALK_BAR_TOP + 18);
  gfx->print("hold here to talk");

}

void drawPhase(const char *big, const char *small, uint16_t color) {

  gfx->fillScreen(C_BLACK);
  gfx->setTextSize(4);
  gfx->setTextColor(color);
  gfx->setCursor(24, LCD_HEIGHT / 2 - 40);
  gfx->print(big);

  if (small && small[0]) {
    int y = LCD_HEIGHT / 2 + 8;
    printWrapped(String(small), 24, y, 2, C_INK_SOFT, 6);
  }

}


// ---------------------------------------------------------------------------
// Voice: record while held -> capture -> speak the reply.
// ---------------------------------------------------------------------------

bool stillHeld() {
  if (digitalRead(BOOT_BTN) == LOW) return true;
  TouchPoint t = readTouch();
  return t.touched && t.y >= TALK_BAR_TOP;
}

// 16kHz stereo 16-bit, downmixed to mono on the fly. 10s hard cap.
size_t recordWhileHeld(int16_t *mono, size_t maxSamples) {

  const size_t CHUNK = 2048;  // stereo frames per read
  static int32_t stereo[2048];

  size_t written = 0;

  const unsigned long start = millis();

  while (written < maxSamples && millis() - start < 10'000UL) {

    // Stop once released — but never before half a second, so a quick tap
    // doesn't upload 80ms of chair squeak.
    if (millis() - start > 500 && !stillHeld()) break;

    const size_t want = min(CHUNK, maxSamples - written) * 2 * sizeof(int16_t);
    const size_t got = i2s.readBytes((char *)stereo, want);

    const int16_t *samples = (const int16_t *)stereo;

    for (size_t i = 0; i + 1 < got / sizeof(int16_t); i += 2) {
      mono[written++] = samples[i];  // left slot carries the mic
      if (written >= maxSamples) break;
    }

  }

  return written;

}

void writeWavHeader(uint8_t *h, uint32_t dataBytes, uint32_t rate) {

  const uint32_t byteRate = rate * 2;

  memcpy(h, "RIFF", 4); *(uint32_t *)(h + 4) = 36 + dataBytes;
  memcpy(h + 8, "WAVEfmt ", 8); *(uint32_t *)(h + 16) = 16;
  *(uint16_t *)(h + 20) = 1;  // PCM
  *(uint16_t *)(h + 22) = 1;  // mono
  *(uint32_t *)(h + 24) = rate;
  *(uint32_t *)(h + 28) = byteRate;
  *(uint16_t *)(h + 32) = 2;  // block align
  *(uint16_t *)(h + 34) = 16; // bits
  memcpy(h + 36, "data", 4); *(uint32_t *)(h + 40) = dataBytes;

}

// POST the recording to /api/capture; returns the spoken reply (or error text).
String sendCapture(const int16_t *mono, size_t samples) {

  const uint32_t dataBytes = samples * sizeof(int16_t);
  const uint32_t wavBytes = 44 + dataBytes;

  uint8_t *wav = (uint8_t *)heap_caps_malloc(wavBytes, MALLOC_CAP_SPIRAM);
  if (!wav) return "Out of memory for the recording.";

  writeWavHeader(wav, dataBytes, RECORD_RATE);
  memcpy(wav + 44, mono, dataBytes);

  size_t b64Cap = 4 * ((wavBytes + 2) / 3) + 4;
  unsigned char *b64 = (unsigned char *)heap_caps_malloc(b64Cap, MALLOC_CAP_SPIRAM);

  if (!b64) { free(wav); return "Out of memory for the upload."; }

  size_t b64Len = 0;
  mbedtls_base64_encode(b64, b64Cap, &b64Len, wav, wavBytes);
  free(wav);

  const char *prefix = "{\"audio_base64\":\"";
  const char *suffix = "\",\"mime_type\":\"audio/wav\"}";

  const size_t bodyLen = strlen(prefix) + b64Len + strlen(suffix);
  uint8_t *body = (uint8_t *)heap_caps_malloc(bodyLen + 1, MALLOC_CAP_SPIRAM);

  if (!body) { free(b64); return "Out of memory for the upload."; }

  memcpy(body, prefix, strlen(prefix));
  memcpy(body + strlen(prefix), b64, b64Len);
  memcpy(body + strlen(prefix) + b64Len, suffix, strlen(suffix) + 1);
  free(b64);

  WiFiClientSecure client;
  HTTPClient http;

  String reply;

  if (httpBegin(http, client, "/api/capture")) {

    http.addHeader("Content-Type", "application/json");
    http.setTimeout(60'000);  // transcription + routing genuinely takes a while

    const int code = http.POST(body, bodyLen);

    if (code == 200) {

      JsonDocument doc;

      if (!deserializeJson(doc, http.getString())) {
        reply = String((const char *)(doc["result"]["message"] | ""));
        if (!reply.length()) reply = "Done.";
      } else {
        reply = "I did something, but the reply didn't parse.";
      }

    } else {
      Serial.printf("[capture] HTTP %d\n", code);
      reply = "The capture failed - check the logs.";
    }

    http.end();

  } else {
    reply = "Couldn't reach Almanac.";
  }

  free(body);

  return reply;

}

// Stream WAV TTS straight to the codec. The header is scanned for its "data"
// chunk rather than assumed to be 44 bytes, and declared sizes are ignored —
// the server may have concatenated chunks, so the stream plays to its end.
void speak(const String &text) {

  if (!text.length()) return;

  if (!audioConfigure(PLAYBACK_RATE)) return;

  WiFiClientSecure client;
  HTTPClient http;

  if (httpBegin(http, client, "/api/tts")) {

    http.addHeader("Content-Type", "application/json");
    http.setTimeout(60'000);

    JsonDocument req;
    req["text"] = text;
    req["format"] = "wav";

    String body;
    serializeJson(req, body);

    const int code = http.POST(body);

    if (code == 200) {

      WiFiClient *stream = http.getStreamPtr();

      static uint8_t buf[4096];

      bool inData = false;
      String header;

      while (http.connected()) {

        const size_t got = stream->readBytes(buf, sizeof(buf));

        if (got == 0) break;

        size_t offset = 0;

        if (!inData) {

          // Accumulate until the "data" marker; audio starts 8 bytes after it.
          header.concat((const char *)buf, got);

          const int at = header.indexOf("data");

          if (at < 0) continue;

          const size_t audioStartsAt = at + 8;

          if (header.length() <= (int)audioStartsAt) continue;

          // Bytes already read past the marker belong to this buffer's tail.
          offset = got - (header.length() - audioStartsAt);
          inData = true;

        }

        // Mono source, stereo slots: duplicate each sample for both ears.
        const int16_t *samples = (const int16_t *)(buf + offset);
        const size_t n = (got - offset) / sizeof(int16_t);

        static int16_t out[4096];

        for (size_t i = 0; i < n; i++) { out[i * 2] = samples[i]; out[i * 2 + 1] = samples[i]; }

        i2s.write((uint8_t *)out, n * 2 * sizeof(int16_t));

      }

    } else {
      Serial.printf("[tts] HTTP %d\n", code);
    }

    http.end();

  }

  audioConfigure(RECORD_RATE);

}

void voiceFlow() {

  phase = LISTENING;
  drawPhase("listening", "release to send", C_TIDE);

  const size_t MAX_SAMPLES = RECORD_RATE * 10;

  int16_t *mono = (int16_t *)heap_caps_malloc(MAX_SAMPLES * sizeof(int16_t), MALLOC_CAP_SPIRAM);

  if (!mono) { phase = IDLE; drawIdle(); return; }

  const size_t samples = recordWhileHeld(mono, MAX_SAMPLES);

  if (samples < RECORD_RATE / 2) {  // under half a second of audio
    free(mono);
    phase = IDLE;
    drawIdle();
    return;
  }

  phase = THINKING;
  drawPhase("thinking", "", C_INK_SOFT);

  const String reply = sendCapture(mono, samples);
  free(mono);

  phase = SPEAKING;
  drawPhase("", reply.c_str(), C_WHITE);
  speak(reply);

  phase = IDLE;
  pollDesk();  // the capture may have changed what's waiting
  drawIdle();

}


// ---------------------------------------------------------------------------
// Boot + main loop
// ---------------------------------------------------------------------------

void setup() {

  Serial.begin(115200);

  // Native USB CDC drops anything written before a host is actually
  // listening — a terminal opened a second late loses every early boot
  // line for good, with no error and no way to replay it. This grace
  // window is what makes those lines catchable at all; it does not delay
  // boot when nothing is attached; because the loop condition still exits
  // the moment three seconds pass either way.
  { unsigned long t = millis(); while (!Serial && millis() - t < 3000) delay(10); }

  Serial.println("\n[boot] almanac-desk starting");

  pinMode(BOOT_BTN, INPUT_PULLUP);

  Wire.begin(IIC_SDA, IIC_SCL);

  // The expander releases the panel and touch resets; without this the touch
  // controller never enumerates. The screen itself usually lights regardless.
  const bool expanderOk = tca9554::begin();

  Serial.printf("[boot] expander init: %s\n", expanderOk ? "ok" : "FAILED (no ACK on 0x20)");

  // Which display/touch chip is actually on this board, checked rather than
  // trusted from AMOLED_V2 in pins.h — the two revisions need different
  // Arduino_GFX panel classes, and sending V1's SH8601 command sequence to a
  // V2 CO5300 controller produces exactly "begin() succeeds, panel stays
  // black": the SPI writes complete with no error because this bus has no
  // read-back path to disagree, they are just the wrong commands for the
  // chip that received them.
  Wire.beginTransmission(ADDR_TOUCH_V1);
  const bool v1TouchAcks = (Wire.endTransmission() == 0);

  Wire.beginTransmission(ADDR_TOUCH_V2);
  const bool v2TouchAcks = (Wire.endTransmission() == 0);

  Serial.printf("[boot] touch probe: FT3168(0x38/V1)=%s  CST816(0x15/V2)=%s  " \
                "firmware built for %s\n",
                v1TouchAcks ? "ACK" : "no", v2TouchAcks ? "ACK" : "no",
                AMOLED_V2 ? "V2" : "V1");

  if (AMOLED_V2 == 0 && v2TouchAcks && !v1TouchAcks) {
    Serial.println("[boot] *** MISMATCH: this is a V2 board, firmware is built for V1 ***");
    Serial.println("[boot] *** set AMOLED_V2 1 in pins.h and reflash ***");
  } else if (AMOLED_V2 == 1 && v1TouchAcks && !v2TouchAcks) {
    Serial.println("[boot] *** MISMATCH: this is a V1 board, firmware is built for V2 ***");
    Serial.println("[boot] *** set AMOLED_V2 0 in pins.h and reflash ***");
  }

  if (!gfx->begin()) Serial.println("[boot] gfx.begin failed");
  else Serial.println("[boot] gfx.begin ok");

  gfx->setBrightness(220);
  gfx->fillScreen(C_BLACK);
  gfx->setTextSize(3);
  gfx->setTextColor(C_MOSS);
  gfx->setCursor(24, 40);
  gfx->print("almanac");

  gfx->setTextSize(2);
  gfx->setTextColor(expanderOk ? C_INK_SOFT : C_EMBER);
  gfx->setCursor(24, 84);
  gfx->print(expanderOk ? "waking up" : "expander missing!");

  WiFi.mode(WIFI_STA);

  // Never print the password. Lengths only, to catch a truncated or
  // whitespace-mangled secrets.h without ever putting the value in a log.
  Serial.printf("[wifi] ssid=\"%s\" (len %d), password len %d\n",
                WIFI_SSID, strlen(WIFI_SSID), strlen(WIFI_PASSWORD));

  // A scan before the connect attempt, rather than guessing blind between a
  // typo, a 5GHz-only network (invisible to this radio) and a weak signal —
  // this prints exactly what the board's 2.4GHz radio actually sees.
  Serial.println("[wifi] scanning...");

  const int found = WiFi.scanNetworks();

  Serial.printf("[wifi] %d network(s) in range:\n", found);

  bool targetSeen = false;

  for (int i = 0; i < found; i++) {

    const bool isTarget = WiFi.SSID(i) == String(WIFI_SSID);

    if (isTarget) targetSeen = true;

    Serial.printf("  %s%-32s ch%-2d  %ddBm  enc=%d\n",
                  isTarget ? "-> " : "   ",
                  WiFi.SSID(i).c_str(), WiFi.channel(i), WiFi.RSSI(i), (int)WiFi.encryptionType(i));

  }

  Serial.printf("[wifi] target SSID visible on 2.4GHz: %s\n", targetSeen ? "YES" : "NO");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  gfx->setCursor(24, 112);
  gfx->setTextColor(C_INK_SOFT);
  gfx->print("wifi: ");
  gfx->print(WIFI_SSID);

  const unsigned long t0 = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20'000UL) delay(200);

  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("[boot] wifi FAILED, status=%d\n", WiFi.status());
    phase = OFFLINE;
    drawPhase("no wifi", "check secrets.h - 2.4GHz only, no eduroam", C_EMBER);
    return;
  }

  Serial.printf("[boot] wifi ok, ip=%s\n", WiFi.localIP().toString().c_str());

  configTzTime(TZ_INFO, "pool.ntp.org", "time.nist.gov");

  const bool audioOk = audioInit();

  Serial.printf("[boot] audio init: %s\n", audioOk ? "ok" : "FAILED");

  if (!audioOk) {
    gfx->setCursor(24, 140);
    gfx->setTextColor(C_EMBER);
    gfx->print("audio init failed");
    delay(1500);
  }

  const bool pollOk = pollDesk();

  Serial.printf("[boot] first /api/desk poll: %s\n", pollOk ? "ok" : "FAILED");

  // Without this, loop()'s own "lastPoll == 0 means never polled" check reads
  // as true on its very first pass regardless of how recently the line above
  // ran, so every boot silently spent a second /api/desk round trip within
  // the same second as the first — caught on real hardware, not in review.
  lastPoll = millis();

  phase = IDLE;
  drawIdle();

  Serial.println("[boot] reached idle - setup complete");

}

void loop() {

  if (phase == OFFLINE) {
    // Keep trying quietly; the dorm router reboots more often than this will.
    if (WiFi.status() == WL_CONNECTED) { phase = IDLE; pollDesk(); drawIdle(); }
    delay(1000);
    return;
  }

  if (phase != IDLE) { delay(50); return; }

  const unsigned long nowMs = millis();

  if (nowMs - lastPoll > POLL_MS || lastPoll == 0) {

    Serial.println("[poll] polling /api/desk...");
    lastPoll = nowMs;
    const bool ok = pollDesk();
    Serial.printf("[poll] %s - attention=%d heap=%u\n", ok ? "ok" : "FAILED",
                  state.attentionCount, (unsigned)ESP.getFreeHeap());
    if (ok) drawIdle();
  }

  if (nowMs - lastClockDraw > 10'000UL) {
    lastClockDraw = nowMs;
    drawClock(false);
  }

  // Inputs. The BOOT side button and the bottom bar both start a capture;
  // a tap on the nudge card resolves it.
  if (digitalRead(BOOT_BTN) == LOW) {
    voiceFlow();
    return;
  }

  TouchPoint t = readTouch();

  if (t.touched) {

    if (t.y >= TALK_BAR_TOP) {
      voiceFlow();
      return;
    }

    if (nudgeTop >= 0 && t.y >= nudgeTop && t.y <= nudgeBottom && state.nudgeId.length()) {

      ackNudge(state.nudgeId);

      // Optimistic: the card leaves the screen now, the poll confirms.
      state.nudgeMessage = "";
      state.attentionCount = max(0, state.attentionCount - 1);
      drawIdle();

      pollDesk();
      drawIdle();

      delay(300);  // debounce the finger that is still descending

    }

  }

  delay(30);

}
