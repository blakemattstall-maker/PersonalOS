// Almanac desk companion — Waveshare ESP32-S3-Touch-AMOLED-1.8.
//
// What it does: once a minute it fetches GET /api/desk?screen=1 — a PNG the
// server renders in Almanac's own typefaces — and blits it to the panel. The
// nudge id rides along in a response header, so tapping the card resolves
// exactly what is on the glass. Hold the bottom bar (or the side BOOT button) to
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
#include <PNGdec.h>

#include "pins.h"
#include "theme.h"
#include "tca9554.h"
#include "touch.h"
#include "es8311.h"
#include "secrets.h"

// After pins.h, deliberately: WAKE_WORD is defined there, and a guard placed
// above its own definition is simply false.
#if WAKE_WORD
#include "ESP_SR.h"
#endif


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

bool audioConfigure(uint32_t rate, bool mono = false) {

  i2s.end();

  i2s.setPins(I2S_BCK_IO, I2S_WS_IO, I2S_DO_IO, I2S_DI_IO, I2S_MCK_IO);

  // Mono for the wake word engine, stereo for everything else.
  //
  // The mic meter settled this: L and R come back byte-identical, because
  // the ES8311 duplicates its single microphone into both slots. Describing
  // that to the detector as "MN" — microphone plus an unused channel — is a
  // lie about the hardware, and it puts the engine down the multi-channel
  // path where it verifies which channel heard the word and then switches
  // ITSELF off waiting for instructions. Mono is what this board actually
  // is, and the vendor's own example notes mono never raises that event.
  if (!i2s.begin(I2S_MODE_STD, rate, I2S_DATA_BIT_WIDTH_16BIT,
                 mono ? I2S_SLOT_MODE_MONO : I2S_SLOT_MODE_STEREO,
                 mono ? I2S_STD_SLOT_LEFT : I2S_STD_SLOT_BOTH)) {
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
  // Gain 3, not 6.
  //
  // The meter settled this too: at 6, ordinary speech at desk distance
  // peaked at 32768 — the largest number a 16-bit sample can hold, which
  // means the waveform was being flattened against the ceiling. A wake word
  // detector matches the shape of a sound, and a clipped voice is a
  // different shape; a transcriber fed the same thing invents. Raising the
  // gain to chase a wake word that was not firing made both worse.
  es8311_microphone_gain_set(codec, (es8311_mic_gain_t)3);

  return true;

}


// The microphone's state, and the ledger.
//
// micArmed is not a software flag that merely ignores audio: muting calls
// i2s.end(), which stops the bit clock the codec needs to hand over any
// samples at all. Muted means the hardware is not sampling, not that
// something downstream is politely discarding.
bool micArmed = true;

// Every recording sent today, counted so the screen can show it. Nothing
// this device uploads should be invisible to somebody standing next to it.
int asksSent = 0;

volatile bool wakeFired = false;

#if WAKE_WORD

// The wake word engine only ever sets a flag. Everything that follows —
// recording, uploading, speaking — happens on the main loop where it is
// visible and interruptible, rather than inside an audio callback.
void onSrEvent(sr_event_t event, int command_id, int phrase_id) {

  // WAKEWORD fires on detection. On a multi-channel input the engine then
  // verifies which channel heard it and puts ITSELF into SR_MODE_OFF
  // (esp32-hal-sr.c: sr_set_mode(SR_MODE_OFF) on WAKENET_CHANNEL_VERIFIED),
  // waiting for the application to say what happens next. Nothing here was
  // saying anything, so a second "Jarvis" could never be heard.
  if (event == SR_EVENT_WAKEWORD || event == SR_EVENT_WAKEWORD_CHANNEL) {
    wakeFired = true;
  }

  Serial.printf("[sr] event=%d cmd=%d phrase=%d\n", (int)event, command_id, phrase_id);

}

#endif


// Start and stop listening, at the hardware level.
//
// Arming brings the I2S clock up and hands the stream to the wake word
// engine. Disarming ends both, which stops the codec being clocked at all —
// the difference between "we ignore the microphone" and "the microphone is
// not running", which is the only version of a mute worth having in a room
// somebody else lives in.
bool armMic() {

#if WAKE_WORD

  if (!audioConfigure(RECORD_RATE, true)) return false;

  ESP_SR.onEvent(onSrEvent);

  // "M": one channel, and it is the microphone. See audioConfigure.
  if (!ESP_SR.begin(i2s, NULL, 0, SR_CHANNELS_MONO, SR_MODE_WAKEWORD, "M")) {
    Serial.println("[mic] wake word engine failed to start");
    return false;
  }

  Serial.println("[mic] armed - wake word listening on-device");

#endif

  micArmed = true;

  return true;

}


void disarmMic() {

#if WAKE_WORD
  ESP_SR.end();
#endif

  i2s.end();

  micArmed = false;

  wakeFired = false;

  Serial.println("[mic] DISARMED - i2s stopped, codec no longer clocked");

}


// ---------------------------------------------------------------------------
// What the server said last — everything the screen renders.
// ---------------------------------------------------------------------------

struct DeskState {
  bool valid = false;
  int attentionCount = 0;
  String nudgeId;
  // "resting" or "answer" — what a tap means depends on it.
  bool showingAnswer = false;
};

DeskState state;

enum Phase { BOOTING, IDLE, LISTENING, THINKING, SPEAKING, OFFLINE };

Phase phase = BOOTING;

// Tap zones. These mirror the server-side layout in deskScreen.js — the
// device cannot see inside the PNG it is showing, so the two must be changed
// together. Kept as named constants rather than magic numbers so that
// coupling is at least visible from here.
const int EYE_TOP = 170;                      // the eye on the resting face
const int EYE_BOTTOM = 320;
const int CARD_TOP = 300;                     // the ember/moss card
const int TALK_BAR_TOP = LCD_HEIGHT - 52;     // the hairline and "hold to talk"

unsigned long lastPoll = 0;

// The server decides when to come back, via x-almanac-next. While a composed
// answer is on screen it wants the device back promptly to replace it with
// the resting face; the rest of the time a minute is plenty for a clock.
unsigned long pollIntervalMs = 60'000UL;


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

void dismissAnswer() {

  WiFiClientSecure client;
  HTTPClient http;

  if (!httpBegin(http, client, "/api/desk")) return;

  http.addHeader("Content-Type", "application/json");

  http.POST("{\"action\":\"dismiss\"}");

  http.end();

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
// The screen, fetched rather than drawn.
//
// Every pixel of the idle screen is rendered by the server (see
// web/app/api/[resource]/deskScreen.js) and arrives here as a PNG. The device
// decodes it a line at a time and pushes it straight at the panel.
//
// The reason is typography. Arduino_GFX's built-in font is a 5x7 bitmap with
// no anti-aliasing, so "bigger" means "blockier" — at the size a desk clock
// needs, every diagonal is a staircase. The server already has Almanac's
// three real typefaces and a CSS renderer, and a 368x448 PNG of a mostly
// black screen is about 23KB, which is nothing once a minute.
//
// It also means the UI can be redesigned without touching this file, or the
// cable: change the renderer, deploy, and the next poll looks different.
// ---------------------------------------------------------------------------

// Allocated only while decoding, never while the network is busy.
//
// A PNG object carries zlib's 32KB sliding window plus its line buffers —
// about 40KB of internal RAM, held permanently when it was a global. That
// was free until the wake word engine moved in and took most of the internal
// heap for its models: TLS then had ~51KB to work with, needs roughly 40-50
// to handshake, and every screen fetch failed with a bare connection error.
//
// The decoder is not needed until the download has finished, so it does not
// exist until then. Same peak memory, very different shape.
PNG *png = nullptr;


// PNGdec keeps the current and previous scanline in one fixed internal
// buffer, but only checks ONE line against its size (png.inl: "iPitch >=
// PNG_MAX_BUFFERED_PIXELS"). At 368px RGBA a line is 1472 bytes, so the two
// it actually stores need ~2976 — comfortably past the 2562-byte default,
// which is sized for 320px-wide images. It does not refuse: it writes over
// the end of the buffer and into its own state, and the symptom is a decode
// that fails while parsing chunks with nothing to suggest memory was the
// problem. build_opt.h raises the ceiling for every translation unit; this
// assert makes a missing flag a build error rather than a corrupted heap.
static_assert(PNG_MAX_BUFFERED_PIXELS >= (LCD_WIDTH * 4 + 1) * 2 + 32,
              "PNG_MAX_BUFFERED_PIXELS too small for this panel width - see build_opt.h");


// A Stream that only knows how to be written into.
//
// This exists because of a subtle, silent failure: the response is
// Transfer-Encoding: chunked, and reading straight from getStreamPtr() hands
// you the raw socket — chunk-size headers in hexadecimal interleaved through
// the body. The bytes arrive, the length looks plausible, and the PNG decoder
// rejects the result with no clue why. HTTPClient::writeToStream() is the API
// that strips that framing, and it wants somewhere to write, so: here.
class BufferSink : public Stream {

public:

  BufferSink(uint8_t *buffer, size_t capacity) : buf(buffer), cap(capacity) {}

  size_t len = 0;

  size_t write(uint8_t c) override {
    if (len >= cap) return 0;
    buf[len++] = c;
    return 1;
  }

  size_t write(const uint8_t *data, size_t size) override {
    const size_t n = (len + size > cap) ? (cap - len) : size;
    memcpy(buf + len, data, n);
    len += n;
    return n;
  }

  // Write-only: the read half of Stream is required by the interface and
  // never called by writeToStream().
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}

private:

  uint8_t *buf;
  size_t cap;

};

// PNGdec's line callback is a plain C function pointer, so the target has to
// be reachable without a closure.
volatile uint32_t linesDrawn = 0;

// The decoded frame, held whole in PSRAM.
//
// The first version blitted each scanline straight to the panel as it was
// decoded — 448 separate one-row writes. Every one reported success and the
// glass never changed, while a single 120x120 block drawn through the very
// same call appeared instantly (the boot self-test in setup() is what
// established that). Whatever the panel dislikes about a stream of tiny
// windowed writes, the answer is to stop making them: decode into a
// framebuffer, then hand the display one transfer. 330KB against 8MB of
// PSRAM is nothing, and it makes the paint atomic, so no half-drawn frame is
// ever visible.
static uint16_t *frame = nullptr;

static int pngDrawLine(PNGDRAW *draw) {

  linesDrawn++;

  if (!frame || draw->y < 0 || draw->y >= LCD_HEIGHT) return 0;

  png->getLineAsRGB565(draw, frame + ((size_t)draw->y * LCD_WIDTH),
                       PNG_RGB565_BIG_ENDIAN, 0xffffffff);

  // Non-zero keeps the decoder going; returning 0 would abort mid-image.
  return 1;

}


// Downloaded whole before decoding: PNG is a compressed stream, so it cannot
// be drawn as it arrives, and 8MB of PSRAM makes buffering the entire file
// the simple correct choice rather than a compromise.
bool fetchScreen() {

  WiFiClientSecure client;
  HTTPClient http;

  // The device owns the microphone's state, so it tells the renderer what to
  // draw rather than the other way round.
  char path[64];
  snprintf(path, sizeof(path), "/api/desk?screen=1&mic=%s&asks=%d",
           micArmed ? "on" : "off", asksSent);

  if (!httpBegin(http, client, path)) return false;

  // The nudge id travels with the picture instead of in a second request, so
  // a tap can never resolve something other than what is on the glass.
  const char *wanted[] = { "x-almanac-nudge", "x-almanac-count", "x-almanac-next", "x-almanac-view" };
  http.collectHeaders(wanted, 4);

  const int code = http.GET();

  if (code != 200) {
    Serial.printf("[screen] HTTP %d\n", code);
    http.end();
    return false;
  }

  // Vercel streams the image chunked, so Content-Length is absent and
  // getSize() reports -1. The length is therefore discovered by reading to
  // the end of the stream rather than trusted up front — the first version
  // believed getSize() and refused every single fetch as "implausible size".
  const int declared = http.getSize();

  const size_t CAP = 400000;

  uint8_t *buf = (uint8_t *)heap_caps_malloc(CAP, MALLOC_CAP_SPIRAM);

  if (!buf) {
    Serial.println("[screen] out of PSRAM");
    http.end();
    return false;
  }

  BufferSink sink(buf, CAP);

  const int written = http.writeToStream(&sink);

  const size_t got = sink.len;

  if (written < 0) {
    Serial.printf("[screen] transfer error %d after %u bytes\n", written, (unsigned)got);
  }

  state.nudgeId = http.header("x-almanac-nudge");
  state.attentionCount = http.header("x-almanac-count").toInt();

  state.showingAnswer = http.header("x-almanac-view") == "answer";

  const long nextIn = http.header("x-almanac-next").toInt();

  if (nextIn >= 5 && nextIn <= 600) pollIntervalMs = (unsigned long)nextIn * 1000UL;

  http.end();

  if (got < 100) {
    Serial.printf("[screen] short read %u\n", (unsigned)got);
    free(buf);
    return false;
  }

  Serial.printf("[screen] declared=%d written=%d got=%u\n", declared, written, (unsigned)got);

  // The socket is closed by now, so the decoder can have the RAM that TLS
  // was using.
  png = new PNG();

  if (!png) {
    Serial.println("[screen] could not allocate the decoder");
    free(buf);
    return false;
  }

  const int rc = png->openRAM(buf, got, pngDrawLine);

  if (rc != PNG_SUCCESS) {
    Serial.printf("[screen] openRAM failed %d\n", rc);
    delete png; png = nullptr;
    free(buf);
    return false;
  }

  if (!frame) {
    frame = (uint16_t *)heap_caps_malloc((size_t)LCD_WIDTH * LCD_HEIGHT * 2, MALLOC_CAP_SPIRAM);
    if (!frame) {
      Serial.println("[screen] no PSRAM for the framebuffer");
      png->close();
      delete png;
      png = nullptr;
      free(buf);
      return false;
    }
  }

  linesDrawn = 0;

  const unsigned long t0 = millis();

  const int decoded = png->decode(NULL, 0);

  const unsigned long tDecode = millis() - t0;

  // One transfer for the whole screen.
  const unsigned long t1 = millis();

  if (decoded == PNG_SUCCESS) {
    gfx->draw16bitBeRGBBitmap(0, 0, frame, LCD_WIDTH, LCD_HEIGHT);
  }

  Serial.printf("[screen] %dx%d type=%d -> %u lines, decode %lums, blit %lums, heap %u\n",
                png->getWidth(), png->getHeight(), png->getPixelType(),
                (unsigned)linesDrawn, tDecode, millis() - t1, (unsigned)ESP.getFreeHeap());

  png->close();

  delete png;
  png = nullptr;

  free(buf);

  if (decoded != PNG_SUCCESS) {
    Serial.printf("[screen] decode failed %d\n", decoded);
    return false;
  }

  state.valid = true;

  return true;

}


// The one screen still drawn locally: what to show when the server cannot be
// reached. Deliberately plain — it exists to say "the picture is stale and
// here is why", not to reimplement the design offline.
void drawOffline(const char *why) {

  gfx->fillScreen(C_BLACK);

  gfx->setTextSize(3);
  gfx->setTextColor(C_EMBER);
  gfx->setCursor(24, 190);
  gfx->print("offline");

  gfx->setTextSize(2);
  gfx->setTextColor(C_INK_SOFT);
  gfx->setCursor(24, 230);
  gfx->print(why);

}


// The transient voice states, drawn locally on purpose: "listening" has to
// appear the instant a finger lands, and a network round trip to render it
// would be slower than the thing it is acknowledging. One or two words in the
// built-in font is a fair trade for feeling immediate — and unlike the idle
// screen, nobody looks at these for more than a few seconds.
void drawPhase(const char *big, const char *small, uint16_t color) {

  gfx->fillScreen(C_BLACK);

  gfx->setTextSize(4);
  gfx->setTextColor(color);
  gfx->setCursor(24, LCD_HEIGHT / 2 - 48);
  gfx->print(big);

  if (small && small[0]) {

    // Naive wrap at the built-in font's fixed 12px advance (size 2).
    const int perLine = (LCD_WIDTH - 48) / 12;

    gfx->setTextSize(2);
    gfx->setTextColor(C_INK_SOFT);

    String rest(small);
    int y = LCD_HEIGHT / 2 + 4;

    while (rest.length() && y < LCD_HEIGHT - 30) {

      int cut = min((int)rest.length(), perLine);

      if (cut < (int)rest.length()) {
        const int space = rest.lastIndexOf(' ', cut);
        if (space > 0) cut = space;
      }

      gfx->setCursor(24, y);
      gfx->print(rest.substring(0, cut));

      rest = rest.substring(cut);
      rest.trim();

      y += 22;

    }

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

// A fixed window, used after a wake word: there is no button being held to
// tell us when the sentence ended, and an open-ended microphone is exactly
// the thing this device promises not to be. Six seconds, then it stops
// whether or not anyone spoke.
size_t recordFixed(int16_t *mono, size_t maxSamples) {

  // PSRAM, not a static array: 8KB of internal RAM held forever is 8KB the
  // TLS handshake does not have.
  int32_t *stereo = (int32_t *)heap_caps_malloc(2048 * sizeof(int32_t), MALLOC_CAP_SPIRAM);

  if (!stereo) return 0;

  size_t written = 0;

  const unsigned long start = millis();

  while (written < maxSamples && millis() - start < 7'000UL) {

    const size_t want = min((size_t)2048, maxSamples - written) * 2 * sizeof(int16_t);
    const size_t got = i2s.readBytes((char *)stereo, want);

    const int16_t *samples = (const int16_t *)stereo;

    for (size_t i = 0; i + 1 < got / sizeof(int16_t); i += 2) {
      mono[written++] = samples[i];
      if (written >= maxSamples) break;
    }

  }

  free(stereo);

  return written;

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
  // surface tells the server this answer is going to a screen and a speaker
  // in a room, so it composes a layout and skips the phone notification.
  const char *suffix = "\",\"mime_type\":\"audio/wav\",\"surface\":\"desk\"}";

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
// True while audio is playing, so a touch can stop it.
volatile bool stopSpeaking = false;


// Find a 4-byte marker in binary data.
//
// This exists because the first version searched for "data" using an Arduino
// String, and a String built from binary truncates at the first NUL. A WAV
// header is full of NULs — the marker was frequently never found, the audio
// was never played, and the device sat silently having "spoken". Bytes get
// searched as bytes.
static int findMarker(const uint8_t *hay, size_t len, const char *needle) {

  for (size_t i = 0; i + 4 <= len; i++) {
    if (hay[i] == needle[0] && hay[i + 1] == needle[1]
     && hay[i + 2] == needle[2] && hay[i + 3] == needle[3]) {
      return (int)i;
    }
  }

  return -1;

}


// Speak, and be stoppable.
//
// Any touch or a press of BOOT ends playback immediately. Being unable to
// stop a paragraph of speech is bad on a desk and worse when the wake word
// fired by accident, which it sometimes will.
void speak(const String &text) {

  if (!text.length()) return;

  if (!audioConfigure(PLAYBACK_RATE)) {
    Serial.println("[tts] could not configure playback");
    return;
  }

  stopSpeaking = false;

  WiFiClientSecure client;
  HTTPClient http;

  if (!httpBegin(http, client, "/api/tts")) {
    Serial.println("[tts] could not reach the server");
    audioConfigure(RECORD_RATE);
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.setTimeout(60'000);

  JsonDocument req;
  req["text"] = text;
  req["format"] = "wav";
  // Asks for the in-room delivery rather than the walking-briefing one.
  req["surface"] = "desk";

  String body;
  serializeJson(req, body);

  const int code = http.POST(body);

  if (code != 200) {
    Serial.printf("[tts] HTTP %d\n", code);
    http.end();
    audioConfigure(RECORD_RATE);
    return;
  }

  WiFiClient *stream = http.getStreamPtr();

  const int declared = http.getSize();

  Serial.printf("[tts] playing, %d bytes declared\n", declared);

  uint8_t chunk[2048];
  int16_t out[2048];

  bool inData = false;

  size_t played = 0;

  unsigned long lastCheck = millis();

  while (http.connected() || stream->available()) {

    if (stopSpeaking) {
      Serial.println("[tts] stopped by touch");
      break;
    }

    const size_t got = stream->readBytes(chunk, sizeof(chunk));

    if (got == 0) break;

    size_t offset = 0;

    if (!inData) {

      // The header is small and arrives in the first read; scanning this
      // buffer for the marker is enough in practice, and if it is not there
      // the whole response is not a WAV worth playing.
      const int at = findMarker(chunk, got, "data");

      if (at < 0) continue;

      offset = (size_t)at + 8;   // skip "data" plus its 4-byte length

      if (offset >= got) continue;

      inData = true;

    }

    const int16_t *samples = (const int16_t *)(chunk + offset);

    const size_t n = (got - offset) / sizeof(int16_t);

    // Mono source, stereo slots: duplicate each sample for both ears.
    for (size_t i = 0; i < n && i * 2 + 1 < 2048; i++) {
      out[i * 2] = samples[i];
      out[i * 2 + 1] = samples[i];
    }

    i2s.write((uint8_t *)out, min(n, (size_t)1024) * 2 * sizeof(int16_t));

    played += n;

    // Poll for a stop request between buffers rather than after the whole
    // thing, which is the difference between a stop button and a label.
    if (millis() - lastCheck > 60) {

      lastCheck = millis();

      if (digitalRead(BOOT_BTN) == LOW) stopSpeaking = true;

      TouchPoint t = readTouch();

      if (t.touched) stopSpeaking = true;

    }

  }

  http.end();

  Serial.printf("[tts] done, %u samples%s\n",
                (unsigned)played, stopSpeaking ? " (interrupted)" : "");

  audioConfigure(RECORD_RATE);

}


void voiceFlow(bool fromWake = false) {

  phase = LISTENING;
  // Unmissable on purpose. Anyone in the room can see the moment this
  // device starts recording, which is the point — a listening indicator that
  // needs explaining is not an indicator.
  drawPhase("listening", fromWake ? "speak now" : "release to send", C_EMBER);

#if WAKE_WORD
  // The detector and the recorder cannot share the I2S stream, so the engine
  // steps aside for the length of the conversation and is restarted after.
  // The bus goes back to stereo too: the engine listens in mono, and the
  // recorders below de-interleave stereo frames.
  if (fromWake) {
    ESP_SR.end();
    audioConfigure(RECORD_RATE);
  }
#endif

  const size_t MAX_SAMPLES = RECORD_RATE * 10;

  int16_t *mono = (int16_t *)heap_caps_malloc(MAX_SAMPLES * sizeof(int16_t), MALLOC_CAP_SPIRAM);

  if (!mono) { phase = IDLE; fetchScreen(); return; }

  const size_t samples = fromWake
    ? recordFixed(mono, RECORD_RATE * 6)   // six seconds, then it stops itself
    : recordWhileHeld(mono, MAX_SAMPLES);

  // Was anyone actually speaking.
  //
  // Peak alone was not enough: a single chair creak or a pop on the mic
  // clears any peak threshold, and then six seconds of near-silence go up to
  // a transcriber that does not return "nothing" when it hears nothing — it
  // invents, confidently, and in whatever language it feels like. Mandarin
  // and German both turned up.
  //
  // Speech is not a spike, it is sustained energy. So this measures loudness
  // over 20ms frames and asks how much of the recording was actually loud.
  // A room with a fan in it fails that test; a sentence passes it easily.
  const size_t FRAME = RECORD_RATE / 50;   // 20ms

  size_t loudFrames = 0;
  size_t totalFrames = 0;

  int32_t peak = 0;

  for (size_t start = 0; start + FRAME <= samples; start += FRAME) {

    uint64_t sumSquares = 0;

    for (size_t i = start; i < start + FRAME; i++) {
      const int32_t v = mono[i];
      sumSquares += (uint64_t)((int64_t)v * v);
      const int32_t a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }

    const int32_t rms = (int32_t)sqrt((double)(sumSquares / FRAME));

    if (rms > 220) loudFrames++;

    totalFrames++;

  }

  const int loudPercent = totalFrames ? (int)((loudFrames * 100) / totalFrames) : 0;

  Serial.printf("[voice] %u samples, peak %ld, %d%% of frames loud\n",
                (unsigned)samples, (long)peak, loudPercent);

  // At least a tenth of the recording has to contain speech-level energy.
  // Six seconds of room with one cough in it does not reach that; "what is
  // on my calendar" is nowhere near the line.
  const bool heardSpeech = loudPercent >= 10 && peak >= 800;

  if (samples >= RECORD_RATE / 2 && !heardSpeech) {
    Serial.println("[voice] no speech in that - not uploading");
    free(mono);
    phase = SPEAKING;
    drawPhase("", "nothing heard", C_INK_SOFT);
    delay(1200);
    phase = IDLE;
    fetchScreen();
    return;
  }

  if (samples < RECORD_RATE / 2) {  // under half a second of audio
    free(mono);
    phase = IDLE;
    fetchScreen();
    return;
  }

  phase = THINKING;
  drawPhase("thinking", "", C_INK_SOFT);

  asksSent++;

  const String reply = sendCapture(mono, samples);
  free(mono);

  phase = SPEAKING;

  // The composed screen first, then the voice over the top of it.
  //
  // This used to paint the raw reply as plain text, speak, and only fetch
  // the designed screen afterwards — so the ugly intermediate was the thing
  // you looked at while it talked, and the good one only appeared if you
  // touched it. The server has already laid the answer out by the time the
  // capture returns; there is nothing to wait for.
  fetchScreen();

  speak(reply);

  phase = IDLE;
#if WAKE_WORD
  // Back to listening for the wake word only — never left recording.
  if (fromWake && micArmed) armMic();
#endif

  // Only re-fetch if the answer was interrupted — otherwise the screen
  // painted before speaking is still the current one.
  if (stopSpeaking) fetchScreen();

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

  // Display self-test.
  //
  // The PNG pipeline reports 448 lines painted in 72ms and the glass still
  // shows the boot splash, which means the pixels are going somewhere other
  // than the panel. The splash and the image reach the bus by different
  // routes — text goes through writePixel, a bitmap goes through
  // writeBytes/writePixels with DMA — so this walks all three in turn and
  // names each one out loud. Whichever colours actually appear identifies
  // the working path; guessing from here is otherwise unfalsifiable.
  if (SELF_TEST) {

    Serial.println("[test] 1/3 fillScreen RED");
    gfx->fillScreen(RGB565_RED);
    delay(1200);

    Serial.println("[test] 2/3 draw16bitBeRGBBitmap BLUE block (the failing path)");
    {
      static uint16_t blue[120 * 120];
      // Big-endian 0x001F -> 0x1F00 on the wire.
      for (int i = 0; i < 120 * 120; i++) blue[i] = 0x1F00;
      gfx->draw16bitBeRGBBitmap(20, 20, blue, 120, 120);
    }
    delay(1200);

    Serial.println("[test] 3/3 draw16bitRGBBitmap GREEN block (little-endian path)");
    {
      static uint16_t green[120 * 120];
      for (int i = 0; i < 120 * 120; i++) green[i] = RGB565_GREEN;
      gfx->draw16bitRGBBitmap(20, 200, green, 120, 120);
    }
    delay(2500);

    Serial.println("[test] done - report which blocks were visible");

  }

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

  // No SNTP, deliberately.
  //
  // Nothing on this device reads a local clock any more — the time on screen
  // is drawn by the server, in the user's timezone, as part of the picture.
  // SNTP was left running to maintain a clock nobody looks at, and its
  // periodic re-sync is the best suspect for the occasional unexplained
  // reboot: the one captured crash was an lwIP assert
  // ("Required to lock TCPIP core functionality") inside udp_new_ip_type,
  // which is the UDP path SNTP uses. Removing the only thing that needed it
  // is better than locking around it.

  const bool audioOk = audioInit();

  Serial.printf("[boot] audio init: %s\n", audioOk ? "ok" : "FAILED");

#if MIC_TEST

  // Measure what the microphone is actually producing.
  //
  // Two separate symptoms — a transcriber inventing Mandarin out of a
  // recording, and a wake word that never fires — have the same simplest
  // explanation: no audio is reaching either of them. Rather than keep
  // theorising about slot formats and gain, this prints the real signal
  // level. Near-zero while somebody is talking at it means the capture path
  // is broken and nothing downstream can be diagnosed until it is fixed.
  if (audioOk) {

    gfx->fillScreen(C_BLACK);
    gfx->setTextSize(3);
    gfx->setTextColor(C_EMBER);
    gfx->setCursor(24, 170);
    gfx->print("say something");
    gfx->setTextSize(2);
    gfx->setTextColor(C_INK_SOFT);
    gfx->setCursor(24, 215);
    gfx->print("mic test");

    int32_t *probe = (int32_t *)heap_caps_malloc(1024 * sizeof(int32_t), MALLOC_CAP_SPIRAM);

    if (probe) {

      // Waits rather than samples a fixed window. The first version ran for
      // eight seconds starting the instant it booted, which meant it was
      // always finished before anyone could be told to talk into it, and it
      // faithfully measured an empty room. This one keeps listening until it
      // actually hears something, or gives up after forty-five seconds.
      const unsigned long until = millis() + 45000;

      int32_t sessionPeak = 0;

      bool heard = false;

      while (millis() < until && !heard) {

        const size_t got = i2s.readBytes((char *)probe, 1024 * sizeof(int32_t));

        const int16_t *sam = (const int16_t *)probe;

        const size_t n = got / sizeof(int16_t);

        // Both slots, reported separately. Which one carries the microphone
        // decides whether the wake word engine's channel format is even
        // pointed at it, and assuming left was exactly the kind of guess
        // that produces a system that hears nothing and says so in Mandarin.
        uint64_t sumL = 0, sumR = 0;
        int32_t pkL = 0, pkR = 0;

        for (size_t i = 0; i + 1 < n; i += 2) {

          const int32_t l = sam[i];
          const int32_t r = sam[i + 1];

          sumL += (uint64_t)((int64_t)l * l);
          sumR += (uint64_t)((int64_t)r * r);

          const int32_t al = l < 0 ? -l : l;
          const int32_t ar = r < 0 ? -r : r;

          if (al > pkL) pkL = al;
          if (ar > pkR) pkR = ar;

        }

        const size_t count = n / 2;

        const int32_t rmsL = count ? (int32_t)sqrt((double)(sumL / count)) : 0;
        const int32_t rmsR = count ? (int32_t)sqrt((double)(sumR / count)) : 0;

        if (pkL > sessionPeak) sessionPeak = pkL;
        if (pkR > sessionPeak) sessionPeak = pkR;

        // Unmistakably a voice rather than a room.
        if (pkL > 4000 || pkR > 4000) heard = true;

        Serial.printf("[mictest] bytes=%u  L rms=%ld peak=%ld   R rms=%ld peak=%ld\n",
                      (unsigned)got, (long)rmsL, (long)pkL, (long)rmsR, (long)pkR);

      }

      Serial.printf("[mictest] DONE heard=%s session peak=%ld\n",
                    heard ? "YES" : "no", (long)sessionPeak);

      free(probe);

    }

  }

#endif

#if WAKE_WORD
  if (audioOk) armMic();
#endif

  if (!audioOk) {
    gfx->setCursor(24, 140);
    gfx->setTextColor(C_EMBER);
    gfx->print("audio init failed");
    delay(1500);
  }

  const bool pollOk = fetchScreen();

  Serial.printf("[boot] first screen fetch: %s\n", pollOk ? "ok" : "FAILED");

  if (!pollOk) drawOffline("could not reach almanac");

  // Without this, loop()'s own "lastPoll == 0 means never polled" check reads
  // as true on its very first pass regardless of how recently the line above
  // ran, so every boot silently spent a second /api/desk round trip within
  // the same second as the first — caught on real hardware, not in review.
  lastPoll = millis();

  phase = IDLE;

  Serial.println("[boot] reached idle - setup complete");

}

void loop() {

  if (phase == OFFLINE) {

    // Actually try again, rather than waiting to be rescued.
    //
    // This used to poll WiFi.status() forever and never call begin() a
    // second time, so a failed association — or a hotspot that slept while
    // the device was unplugged — parked it offline permanently with nothing
    // on screen to say why. That is the normal case for a thing you carry
    // around: it leaves the network and comes back.
    static unsigned long lastAttempt = 0;
    static int attempts = 0;

    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("[wifi] reconnected, ip=%s\n", WiFi.localIP().toString().c_str());
      attempts = 0;
      phase = IDLE;
      fetchScreen();
      return;
    }

    if (millis() - lastAttempt > 15'000UL) {

      lastAttempt = millis();
      attempts++;

      Serial.printf("[wifi] retry %d (status=%d)\n", attempts, WiFi.status());

      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

      char note[64];
      snprintf(note, sizeof(note), "looking for %s", WIFI_SSID);
      drawOffline(note);

    }

    delay(500);

    return;

  }

  if (phase != IDLE) { delay(50); return; }

  const unsigned long nowMs = millis();

  if (nowMs - lastPoll > pollIntervalMs || lastPoll == 0) {

    Serial.println("[poll] polling /api/desk...");
    lastPoll = nowMs;
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[wifi] connection lost");
      phase = OFFLINE;
      drawOffline("reconnecting");
      return;
    }

    const bool ok = fetchScreen();
    Serial.printf("[poll] %s - attention=%d heap=%u\n", ok ? "ok" : "FAILED",
                  state.attentionCount, (unsigned)ESP.getFreeHeap());
    if (!ok) drawOffline("almanac unreachable");
  }

#if WAKE_WORD
  // A wake word was heard on-device. Nothing has been recorded or sent yet;
  // that starts here, in the open, with the screen showing it.
  if (wakeFired) {
    wakeFired = false;
    if (micArmed) {
      voiceFlow(true);
      return;
    }
  }
#endif

  // Inputs. The BOOT side button and the bottom bar both start a capture;
  // a tap on the nudge card resolves it. The button works whether or not the
  // microphone is armed for wake words — holding it is an explicit act, and
  // it re-arms the hardware just for that recording.
  if (digitalRead(BOOT_BTN) == LOW) {
    if (!micArmed) {
      audioConfigure(RECORD_RATE);
      voiceFlow();
      i2s.end();
    } else {
      voiceFlow();
    }
    return;
  }

  TouchPoint t = readTouch();

  if (t.touched) {

    if (t.y >= TALK_BAR_TOP) {
      voiceFlow();
      return;
    }

    // On a composed answer, a tap anywhere above the talk bar means "done
    // with this" — not "mute", which is what the resting face's zones would
    // otherwise have said, and which is a genuinely bad thing to do by
    // accident in a shared room.
    if (state.showingAnswer) {

      // Drawn before the network call, not after. Waiting on a round trip to
      // acknowledge a touch is what made every control feel broken: the tap
      // registered immediately and the glass sat unchanged for two seconds,
      // so it read as a missed press and got pressed again.
      drawPhase("", "putting that away", C_INK_SOFT);

      dismissAnswer();

      state.showingAnswer = false;

      fetchScreen();

      delay(250);

      return;

    }

    // The eye is the mute switch. Tapping the thing that looks like it is
    // watching you is the one gesture nobody needs told to them, and it is
    // the control most worth making obvious in a shared room.
    if (t.y >= EYE_TOP && t.y < EYE_BOTTOM) {

      // Paint before doing anything slow, not after.
      //
      // Tearing the wake word engine down and standing it back up means
      // unloading and reloading neural network models out of a 3MB flash
      // partition, which takes on the order of a second or two. Calling that
      // first and drawing afterwards is why a tap on the eye appeared to
      // take 2.5 seconds to register: the touch was read immediately and the
      // glass could not change until the models had finished moving.
      const unsigned long t0 = millis();

      if (micArmed) {

        drawPhase("mic off", "stopping the microphone", C_INK_SOFT);
        disarmMic();

      } else {

        drawPhase("mic on", "starting the wake word", C_MOSS);
        armMic();

      }

      Serial.printf("[mic] toggle took %lums\n", millis() - t0);

      fetchScreen();

      return;

    }

    if (t.y >= CARD_TOP && t.y < TALK_BAR_TOP && state.nudgeId.length()) {

      ackNudge(state.nudgeId);

      // Re-fetch rather than patch: the server decides what is waiting, and
      // asking it again is both simpler and correct if something else
      // resolved in the meantime.
      state.nudgeId = "";
      fetchScreen();

      delay(300);  // debounce the finger that is still descending

    }

  }

  delay(30);

}
