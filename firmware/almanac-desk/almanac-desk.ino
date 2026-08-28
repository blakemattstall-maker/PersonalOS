// Almanac desk companion — Waveshare ESP32-S3-Touch-AMOLED-1.8.
//
// What it does: once a minute it fetches GET /api/desk?screen=1 — a PNG the
// server renders in Almanac's own typefaces — and blits it to the panel. The
// nudge id rides along in a response header, so tapping the card resolves
// exactly what is on the glass. Say "Jarvis" (or hold the bottom bar / BOOT)
// to talk: the recording goes up as one raw-WAV POST to /api/capture, and
// the reply comes back down the same connection as a stream of typed frames
// — speech audio as it is synthesized, the composed answer screen mid-
// sentence, control metadata — so the voice starts seconds after the
// sentence ends instead of after every stage has finished. The TLS
// handshake runs on the other core while the sentence is still being
// spoken. See `converse` below for the frame protocol.
//
// Build notes live in README.md. Pins are verified against Waveshare's own
// sources (pins.h); the display/touch/audio init sequences are lifted from
// the official demos, which is the difference between "should work" and
// "worked on this exact board".

#include <Arduino.h>
#include <new>
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
#include "flowtypes.h"
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
// Audio — one I2S bus to the ES8311, one rate, never reconfigured.
//
// 16kHz both directions: it is what the wake word engine and the transcriber
// want, and the server resamples its 24kHz speech down before streaming it.
// One rate is what lets the wake word engine be paused for a conversation
// instead of destroyed and rebuilt.
// ---------------------------------------------------------------------------

I2SClass i2s;

es8311_handle_t codec = NULL;

const uint32_t RECORD_RATE = 16000;

// What slot mode the bus is actually in, so the recorders read it correctly:
// mono delivers every sample as the microphone, stereo duplicates the mic
// into both slots and only one of each pair is wanted.
bool busIsMono = false;

bool audioConfigure(uint32_t rate, bool mono = false) {

  busIsMono = mono;

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

// Whether answers are spoken at all. There is a button for this on the
// resting face and a pair of voice commands, because wanting the screen
// without the noise is a normal thing to want in a shared room.
bool ttsEnabled = true;

// Speaker level. The codec lives here, so the number lives here — the
// screen only draws it (the dots in the resting footer). Five steps across
// 40..100; "louder"/"quieter" by voice and the −/+ on the glass both land
// here. Never zero: silence is what the voice switch is for.
int volumePercent = 85;

void applyVolume() {
  volumePercent = max(40, min(100, volumePercent));
  if (codec) es8311_voice_volume_set(codec, volumePercent, NULL);
  Serial.printf("[vol] %d%%\n", volumePercent);
}

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
// Campus first, hotspot second.
//
// Carrying a phone hotspot around to keep a desk device online is a chore,
// and the campus network is right there. isunet is WPA2-Enterprise, which
// the ESP32 does support — it just needs an identity and password instead of
// a shared key. If that is refused (expired password, a RADIUS mood, not on
// campus) it falls back to the hotspot rather than sitting offline.
void connectWiFi(bool preferFallback = false) {

  WiFi.disconnect(true);

  delay(100);

#if WIFI_ENTERPRISE

  if (!preferFallback) {
    Serial.printf("[wifi] trying %s as %s (WPA2-Enterprise)\n", WIFI_EAP_SSID, WIFI_EAP_IDENTITY);
    WiFi.begin(WIFI_EAP_SSID, WPA2_AUTH_PEAP, WIFI_EAP_IDENTITY, WIFI_EAP_USERNAME, WIFI_EAP_PASSWORD);
    return;
  }

#endif

  Serial.printf("[wifi] trying %s\n", WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

}


bool armMic() {

#if WAKE_WORD

  if (!audioConfigure(RECORD_RATE, true)) return false;

  ESP_SR.onEvent(onSrEvent);

  // "M": one channel, and it is the microphone. See audioConfigure.
  if (!ESP_SR.begin(i2s, NULL, 0, SR_CHANNELS_MONO, SR_MODE_WAKEWORD, "M")) {
    Serial.println("[mic] wake word engine failed to start");
    return false;
  }

  Serial.printf("[mic] armed - wake word listening on-device (heap %u)\n",
                (unsigned)ESP.getFreeHeap());

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
// The footer strip. On the resting face it is the speech switch; on an
// answer screen a tap anywhere dismisses, so this only matters when resting.
const int FOOTER_TOP = 396;
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

// Where the current decode is writing — the idle framebuffer above, or one
// of the cached phase frames.
static uint16_t *decodeTarget = nullptr;

static int pngDrawLine(PNGDRAW *draw) {

  linesDrawn++;

  if (!decodeTarget || draw->y < 0 || draw->y >= LCD_HEIGHT) return 0;

  png->getLineAsRGB565(draw, decodeTarget + ((size_t)draw->y * LCD_WIDTH),
                       PNG_RGB565_BIG_ENDIAN, 0xffffffff);

  // Non-zero keeps the decoder going; returning 0 would abort mid-image.
  return 1;

}


// Decode one downloaded PNG into a full-frame RGB565 buffer.
//
// The decoder object itself is placed in PSRAM, not `new`ed onto the
// internal heap: it carries zlib's 32KB window and weighs ~48KB, and during
// the streaming exchange it now runs WHILE a TLS connection is alive — the
// exact pair that could not coexist in internal RAM once the wake word
// engine claimed its share. PSRAM decode is a shade slower and entirely
// unbothered by any of that.
bool decodePngTo(uint8_t *data, size_t len, uint16_t *dest) {

  void *mem = heap_caps_malloc(sizeof(PNG), MALLOC_CAP_SPIRAM);

  if (!mem) return false;

  png = new (mem) PNG();

  if (png->openRAM(data, len, pngDrawLine) != PNG_SUCCESS) {
    Serial.println("[png] openRAM failed");
    png->~PNG();
    heap_caps_free(mem);
    png = nullptr;
    return false;
  }

  decodeTarget = dest;
  linesDrawn = 0;

  const unsigned long t0 = millis();

  const int decoded = png->decode(NULL, 0);

  Serial.printf("[png] %u lines in %lums, heap %u\n",
                (unsigned)linesDrawn, millis() - t0, (unsigned)ESP.getFreeHeap());

  png->close();
  png->~PNG();
  heap_caps_free(mem);
  png = nullptr;
  decodeTarget = nullptr;

  return decoded == PNG_SUCCESS;

}


// ---------------------------------------------------------------------------
// The waiting states, cached as pictures.
//
// "Listening" and "thinking" used to be the built-in 5x7 font on black — and
// they were on the glass for most of every exchange, which made them most of
// the UI anyone actually saw. The server now renders them in the real
// typefaces (deskScreen.js, preview=phase-*); the device fetches all four
// ONCE at boot and blits from PSRAM, so they still appear the instant a
// finger lands or a wake word fires. Thinking has two frames a few pixels
// apart; alternating them is what makes waiting look alive instead of hung.
// ---------------------------------------------------------------------------

static const char *PHASE_PREVIEWS[PF_COUNT] = {
  "phase-listening", "phase-thinking", "phase-thinking-2", "phase-speaking"
};

static uint16_t *phaseFrames[PF_COUNT] = { nullptr, nullptr, nullptr, nullptr };

// Cached frame if it exists, the old plain-font drawing when it does not —
// a failed boot fetch costs polish, never the indicator.
void drawPhaseCached(PhaseFrame which, const char *big, const char *small, uint16_t color) {

  if (phaseFrames[which]) {
    gfx->draw16bitBeRGBBitmap(0, 0, phaseFrames[which], LCD_WIDTH, LCD_HEIGHT);
    return;
  }

  drawPhase(big, small, color);

}

void drawThinking(bool flip) {
  drawPhaseCached(flip ? PF_THINK2 : PF_THINK, "thinking", "", C_INK_SOFT);
}


// Downloaded whole before decoding: PNG is a compressed stream, so it cannot
// be drawn as it arrives, and 8MB of PSRAM makes buffering the entire file
// the simple correct choice rather than a compromise.
//
// `fresh` rides on the fetch that follows a tap or a spoken command — it
// tells the server to skip its short source cache, so the thing just acted
// on visibly changes. The minute-poll never sets it.
bool fetchScreen(bool fresh = false) {

  WiFiClientSecure client;
  HTTPClient http;

  // The device owns the microphone's state, so it tells the renderer what to
  // draw rather than the other way round.
  char path[96];
  snprintf(path, sizeof(path), "/api/desk?screen=1&mic=%s&asks=%d&tts=%s&vol=%d%s",
           micArmed ? "on" : "off", asksSent, ttsEnabled ? "on" : "off",
           volumePercent, fresh ? "&fresh=1" : "");

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

  if (!frame) {
    frame = (uint16_t *)heap_caps_malloc((size_t)LCD_WIDTH * LCD_HEIGHT * 2, MALLOC_CAP_SPIRAM);
    if (!frame) {
      Serial.println("[screen] no PSRAM for the framebuffer");
      free(buf);
      return false;
    }
  }

  const bool decoded = decodePngTo(buf, got, frame);

  free(buf);

  if (!decoded) {
    Serial.println("[screen] decode failed");
    return false;
  }

  // One transfer for the whole screen.
  gfx->draw16bitBeRGBBitmap(0, 0, frame, LCD_WIDTH, LCD_HEIGHT);

  state.valid = true;

  return true;

}


// One phase frame, downloaded and decoded into its PSRAM slot at boot.
bool loadPhaseFrame(PhaseFrame which) {

  WiFiClientSecure client;
  HTTPClient http;

  char path[64];
  snprintf(path, sizeof(path), "/api/desk?screen=1&preview=%s", PHASE_PREVIEWS[which]);

  if (!httpBegin(http, client, path)) return false;

  if (http.GET() != 200) { http.end(); return false; }

  const size_t CAP = 400000;

  uint8_t *buf = (uint8_t *)heap_caps_malloc(CAP, MALLOC_CAP_SPIRAM);

  if (!buf) { http.end(); return false; }

  BufferSink sink(buf, CAP);

  http.writeToStream(&sink);

  http.end();

  if (sink.len < 100) { free(buf); return false; }

  if (!phaseFrames[which]) {
    phaseFrames[which] = (uint16_t *)heap_caps_malloc((size_t)LCD_WIDTH * LCD_HEIGHT * 2, MALLOC_CAP_SPIRAM);
  }

  const bool ok = phaseFrames[which]
    && decodePngTo(buf, sink.len, phaseFrames[which]);

  free(buf);

  return ok;

}


void loadPhaseFrames() {

  const unsigned long t0 = millis();

  int loaded = 0;

  for (int i = 0; i < PF_COUNT; i++) {
    if (loadPhaseFrame((PhaseFrame)i)) loaded++;
  }

  Serial.printf("[phase] %d/%d frames cached in %lums\n", loaded, PF_COUNT, millis() - t0);

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

// The BOOT button is the only push-to-talk now. The bottom touch strip used
// to be one too, and it sat on exactly the same pixels as the voice switch —
// with the talk check running first, the switch could never be reached. The
// wake word and the physical button cover talking; the footer belongs to
// its controls.
bool stillHeld() {
  return digitalRead(BOOT_BTN) == LOW;
}

// A fixed window, used after a wake word: there is no button being held to
// tell us when the sentence ended, and an open-ended microphone is exactly
// the thing this device promises not to be. Six seconds, then it stops
// whether or not anyone spoke.
// Speech-level energy, at the gain this microphone actually runs at.
//
// These were first calibrated with the codec at gain 6 and then the gain was
// dropped to 3 to stop speech clipping — which made everything about four
// times quieter and left the thresholds rejecting real sentences. A measured
// utterance at gain 3 peaks around 3000-4000 with frame RMS in the low
// hundreds, so this sits well under that and comfortably over room tone.
static const int32_t SPEECH_RMS = 90;
static const int32_t SPEECH_PEAK = 600;


size_t recordFixed(int16_t *mono, size_t maxSamples) {

  // PSRAM, not a static array: 8KB of internal RAM held forever is 8KB the
  // TLS handshake does not have.
  int32_t *stereo = (int32_t *)heap_caps_malloc(2048 * sizeof(int32_t), MALLOC_CAP_SPIRAM);

  if (!stereo) return 0;

  size_t written = 0;

  const unsigned long start = millis();

  // Stop when they stop, rather than always recording six seconds.
  //
  // A fixed window meant "never mind" was one second of speech inside five
  // of silence — which failed a percentage-of-loud-frames test, and gave the
  // transcriber five seconds of nothing to invent over. Ending on a pause
  // makes short commands work and makes the whole thing feel answered
  // rather than timed.
  bool heardAnything = false;
  unsigned long lastLoud = 0;

  while (written < maxSamples && millis() - start < 9'000UL) {

    const size_t want = min((size_t)2048, maxSamples - written) * sizeof(int16_t);
    const size_t got = i2s.readBytes((char *)stereo, want);

    const int16_t *samples = (const int16_t *)stereo;

    uint64_t sum = 0;
    size_t counted = 0;

    // Mono slot mode: every sample is the microphone, none are a duplicate.
    for (size_t i = 0; i < got / sizeof(int16_t); i++) {
      const int32_t v = samples[i];
      sum += (uint64_t)((int64_t)v * v);
      counted++;
      mono[written++] = v;
      if (written >= maxSamples) break;
    }

    const int32_t rms = counted ? (int32_t)sqrt((double)(sum / counted)) : 0;

    if (rms > SPEECH_RMS) {
      heardAnything = true;
      lastLoud = millis();
    }

    // A second of quiet after something was said means the sentence is over.
    if (heardAnything && lastLoud && millis() - lastLoud > 1000UL) break;

    // Nobody started talking at all.
    if (!heardAnything && millis() - start > 3500UL) break;

  }

  free(stereo);

  return written;

}


// 16kHz 16-bit, downmixed to mono on the fly. 10s hard cap.
//
// The stride follows the bus. With the wake word engine armed the bus runs
// mono and every sample is the microphone; assuming stereo there — which
// this function did — silently kept every OTHER sample, which is a
// half-speed recording that transcribes as gibberish. The button path with
// the mic armed was the one combination that hit it.
size_t recordWhileHeld(int16_t *mono, size_t maxSamples) {

  const size_t CHUNK = 2048;
  static int32_t raw[2048];

  const size_t stride = busIsMono ? 1 : 2;

  size_t written = 0;

  const unsigned long start = millis();

  while (written < maxSamples && millis() - start < 10'000UL) {

    // Stop once released — but never before half a second, so a quick tap
    // doesn't upload 80ms of chair squeak.
    if (millis() - start > 500 && !stillHeld()) break;

    const size_t want = min(CHUNK, maxSamples - written) * stride * sizeof(int16_t);
    const size_t got = i2s.readBytes((char *)raw, min(want, sizeof(raw)));

    const int16_t *samples = (const int16_t *)raw;

    for (size_t i = 0; i + (stride - 1) < got / sizeof(int16_t); i += stride) {
      mono[written++] = samples[i];  // in stereo, the left slot carries the mic
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

// True while audio is playing, so a touch can stop it.
volatile bool stopSpeaking = false;


// ---------------------------------------------------------------------------
// The streaming exchange.
//
// One POST carries the recording up as raw WAV; the response is a stream of
// typed frames — [type:1][length:4 LE][payload] — that the server emits as
// each stage finishes rather than when all of them have:
//
//   'M'  meta, JSON: what was heard and how it was handled
//   'A'  audio: 16kHz mono s16le PCM, sent as it is synthesized
//   'P'  the composed answer screen, as a PNG, mid-speech
//   'E'  the exchange is over
//
// The old shape was three serial requests — capture, then screen, then a TTS
// download that had to finish before the first sample played — each behind
// its own 1-3 second TLS handshake. This is one connection, opened WHILE the
// user is still speaking (see preconnect below), with playback starting the
// moment a quarter-second of audio has arrived.
// ---------------------------------------------------------------------------

// The TLS connection for the exchange, handshaken on the other core while
// the microphone is still recording — the one place the S3's slow ECC math
// can hide completely. Stopped at the end of every exchange: a resident TLS
// context costs ~50KB of the internal RAM the wake word engine already
// pressures, and holding it between conversations buys nothing.
WiFiClientSecure exchangeClient;

volatile bool preconnectDone = false;

String apiHost() {
  String host = String(API_BASE);
  host.replace("https://", "");
  host.replace("http://", "");
  const int slash = host.indexOf('/');
  return slash >= 0 ? host.substring(0, slash) : host;
}

void preconnectTask(void *arg) {
  exchangeClient.setInsecure();
  if (!exchangeClient.connected()) {
    exchangeClient.connect(apiHost().c_str(), 443, 15000);
  }
  preconnectDone = true;
  vTaskDelete(NULL);
}

void startPreconnect() {
  preconnectDone = false;
  if (exchangeClient.connected()) { preconnectDone = true; return; }
  if (xTaskCreatePinnedToCore(preconnectTask, "tlspre", 12288, NULL, 1, NULL, 0) != pdPASS) {
    // No task, no parallelism — the POST below will connect inline instead.
    preconnectDone = true;
  }
}


// Pull-based body reader that understands chunked transfer.
//
// The exchange has to be read progressively — that is its entire point — and
// getStreamPtr() hands over the raw socket, hex chunk-size framing included.
// writeToStream() strips that framing but blocks until the response ends,
// which is exactly the wrong shape for audio meant to play while arriving.
// So the framing is handled here, byte-honestly: a read that returns 0 means
// "nothing yet", and only a closed socket or the terminal chunk means done.
struct HttpBody {

  WiFiClientSecure *cl = nullptr;
  bool chunked = false;
  long remaining = 0;      // plain: bytes left in body; chunked: in this chunk
  bool started = false;    // chunked: whether any chunk header has been read
  bool done = false;

  void begin(WiFiClientSecure *client, bool isChunked, long contentLength) {
    cl = client;
    chunked = isChunked;
    remaining = isChunked ? 0 : contentLength;
    started = false;
    done = false;
  }

  int rawByte(uint32_t deadline) {
    while (!cl->available()) {
      if (!cl->connected() && !cl->available()) return -1;
      if (millis() > deadline) return -2;
      delay(1);
    }
    return cl->read();
  }

  // Reads the "\r\nSIZE\r\n" between chunks. Returns false on end-of-body or
  // error, with `done` telling the two apart.
  bool nextChunk(uint32_t deadline) {

    if (started) {
      // The CRLF that closes the previous chunk's data.
      if (rawByte(deadline) < 0 || rawByte(deadline) < 0) return false;
    }

    long size = 0;
    bool any = false;

    for (;;) {
      const int c = rawByte(deadline);
      if (c < 0) return false;
      if (c == '\r') continue;
      if (c == '\n') { if (any) break; else continue; }
      if (c == ';') { while (rawByte(deadline) != '\n') {} break; }   // chunk extension
      const int v = (c >= '0' && c <= '9') ? c - '0'
                  : (c >= 'a' && c <= 'f') ? c - 'a' + 10
                  : (c >= 'A' && c <= 'F') ? c - 'A' + 10 : -1;
      if (v < 0) return false;
      size = size * 16 + v;
      any = true;
    }

    started = true;

    if (size == 0) {
      // Trailer section: consume lines until the empty one that ends the
      // body. Usually there are no trailers, so this is one bare CRLF.
      int lineLen = 0;
      for (;;) {
        const int c = rawByte(deadline);
        if (c < 0) break;
        if (c == '\n') { if (lineLen == 0) break; lineLen = 0; continue; }
        if (c != '\r') lineLen++;
      }
      done = true;
      return false;
    }

    remaining = size;
    return true;

  }

  // Up to `max` payload bytes. >0 data, 0 nothing-yet (call again), <0 over.
  int read(uint8_t *out, int max, uint32_t timeoutMs) {

    if (done) return -1;

    const uint32_t deadline = millis() + timeoutMs;

    if (chunked && remaining == 0) {
      if (!nextChunk(deadline)) return done ? -1 : (cl->connected() ? 0 : -1);
    }

    if (!chunked && remaining == 0) { done = true; return -1; }

    const int avail = cl->available();

    if (avail <= 0) {
      if (!cl->connected()) { done = true; return -1; }
      return 0;
    }

    int take = min(avail, max);
    if (remaining > 0) take = (int)min((long)take, remaining);

    const int got = cl->read(out, take);

    if (got > 0 && remaining > 0) {
      remaining -= got;
      if (!chunked && remaining == 0) done = true;
    }

    return got > 0 ? got : 0;

  }

};


// Downloaded speech waiting for the speaker, in PSRAM. Written by the frame
// reader, drained 16ms at a time by the pump — both on the main loop, so no
// locking, and a press still lands between any two writes.
struct AudioRing {

  uint8_t *buf = nullptr;
  size_t cap = 0;
  size_t head = 0, tail = 0, count = 0;

  bool ensure() {
    if (buf) return true;
    // A megabyte holds ~32 seconds of 16kHz speech — comfortably the whole
    // answer, since synthesis streams in ~3.5x faster than playback drains.
    cap = 1024 * 1024;
    buf = (uint8_t *)heap_caps_malloc(cap, MALLOC_CAP_SPIRAM);
    return buf != nullptr;
  }

  void clear() { head = tail = count = 0; }

  size_t write(const uint8_t *data, size_t n) {
    n = min(n, cap - count);
    for (size_t i = 0; i < n; i++) { buf[head] = data[i]; head = (head + 1) % cap; }
    count += n;
    return n;
  }

  size_t read(uint8_t *out, size_t n) {
    n = min(n, count);
    for (size_t i = 0; i < n; i++) { out[i] = buf[tail]; tail = (tail + 1) % cap; }
    count -= n;
    return n;
  }

};

AudioRing ring;


// Feed the speaker from the ring, one short chunk per call, inputs checked
// every single time. Returns false once an interrupt has been requested.
bool pumpAudio() {

  static uint8_t out[512];   // 256 samples, 16ms

  const size_t n = ring.read(out, sizeof(out));

  if (n) i2s.write(out, n);

  if (digitalRead(BOOT_BTN) == LOW) stopSpeaking = true;

  TouchPoint t = readTouch();
  if (t.touched) stopSpeaking = true;

  return !stopSpeaking;

}


// The whole spoken exchange over one socket. Uploads the WAV, then reads
// frames until the server says it is done — playing audio as it arrives,
// blitting the composed screen the moment it lands, animating "thinking"
// in the waiting gaps.
ConverseOutcome converse(const int16_t *mono, size_t samples) {

  ConverseOutcome out;

  const uint32_t dataBytes = samples * sizeof(int16_t);
  const uint32_t wavBytes = 44 + dataBytes;

  uint8_t *wav = (uint8_t *)heap_caps_malloc(wavBytes, MALLOC_CAP_SPIRAM);

  if (!wav || !ring.ensure()) { free(wav); return out; }

  writeWavHeader(wav, dataBytes, RECORD_RATE);
  memcpy(wav + 44, mono, dataBytes);

  // Let the handshake that started during recording finish its work.
  { const unsigned long t0 = millis();
    while (!preconnectDone && millis() - t0 < 20'000UL) delay(10); }

  HTTPClient http;

  if (!http.begin(exchangeClient, String(API_BASE) + "/api/capture")) {
    free(wav);
    return out;
  }

  http.addHeader("x-pos-key", API_KEY);
  http.addHeader("Content-Type", "audio/wav");
  http.addHeader("x-desk-mic", micArmed ? "on" : "off");
  http.addHeader("x-desk-asks", String(asksSent));
  http.addHeader("x-desk-tts", ttsEnabled ? "on" : "off");
  http.setTimeout(60'000);

  const char *wanted[] = { "Transfer-Encoding" };
  http.collectHeaders(wanted, 1);

  const int code = http.POST(wav, wavBytes);

  free(wav);

  if (code != 200) {
    Serial.printf("[converse] HTTP %d\n", code);
    http.end();
    exchangeClient.stop();
    return out;
  }

  HttpBody body;
  body.begin(&exchangeClient,
             http.header("Transfer-Encoding").indexOf("chunked") >= 0,
             http.getSize());

  ring.clear();
  stopSpeaking = false;

  // Frame parse state.
  uint8_t head[5];
  size_t headGot = 0;
  char type = 0;
  uint32_t need = 0, got = 0;

  // Side buffers: meta/end are small JSON; the screen is a whole PNG.
  static char meta[2048];
  const size_t PNG_CAP = 400000;
  uint8_t *pngBuf = nullptr;
  bool playbackStarted = false;
  bool ended = false;

  unsigned long lastData = millis();
  unsigned long lastAnim = 0;
  bool animFlip = false;

  static uint8_t chunk[4096];

  while (!ended) {

    // Nothing for 30s means the server died mid-answer; don't sit forever.
    if (millis() - lastData > 30'000UL) { Serial.println("[converse] stalled"); break; }

    // Keep the speaker fed before anything else.
    if (playbackStarted && !pumpAudio()) { out.interrupted = true; break; }

    // Backpressure: synthesis arrives ~3.5x faster than the speaker drains,
    // so a long answer would overflow the ring and silently drop audio
    // mid-sentence. When the ring is nearly full, stop reading the socket
    // and just play — TCP holds the rest where it is.
    if (playbackStarted && ring.count > ring.cap - 32 * 1024) continue;

    // Waiting is a designed state, not a frozen one.
    if (!playbackStarted && millis() - lastAnim > 650) {
      lastAnim = millis();
      animFlip = !animFlip;
      drawThinking(animFlip);
      if (digitalRead(BOOT_BTN) == LOW) { out.interrupted = true; break; }
      TouchPoint t = readTouch();
      if (t.touched) { out.interrupted = true; break; }
    }

    // Header, then payload, fed straight to where it belongs.
    if (headGot < 5) {

      const int n = body.read(head + headGot, 5 - headGot, 1000);
      if (n < 0) break;
      if (n == 0) continue;

      headGot += n;
      lastData = millis();

      if (headGot == 5) {
        type = (char)head[0];
        need = (uint32_t)head[1] | ((uint32_t)head[2] << 8) | ((uint32_t)head[3] << 16) | ((uint32_t)head[4] << 24);
        got = 0;
        if (type == 'P' && !pngBuf) pngBuf = (uint8_t *)heap_caps_malloc(PNG_CAP, MALLOC_CAP_SPIRAM);
        if (need == 0) { headGot = 0; if (type == 'E') ended = true; }
      }

      continue;

    }

    const uint32_t left = need - got;
    const int n = body.read(chunk, min((uint32_t)sizeof(chunk), left), 1000);

    if (n < 0) break;
    if (n == 0) continue;

    lastData = millis();

    if (type == 'A') {

      ring.write(chunk, n);

      // A quarter-second in hand is enough to never underrun and short
      // enough that speech starts effectively with the first frames.
      if (!playbackStarted && ring.count >= 8000) {
        playbackStarted = true;
        drawPhaseCached(PF_SPEAK, "speaking", "tap to stop", C_MOSS);
        phase = SPEAKING;
      }

    } else if (type == 'P' && pngBuf && got + n <= PNG_CAP) {

      memcpy(pngBuf + got, chunk, n);

    } else if ((type == 'M' || type == 'E') && got + n < sizeof(meta)) {

      memcpy(meta + got, chunk, n);

    }

    got += n;

    if (got >= need) {

      if (type == 'M') {

        meta[min((size_t)need, sizeof(meta) - 1)] = 0;

        JsonDocument doc;

        if (!deserializeJson(doc, meta)) {

          const char *kind = doc["kind"] | "";
          const char *speech = doc["speech"] | "";
          const char *vol = doc["volume"] | "";

          if (strcmp(speech, "off") == 0) ttsEnabled = false;
          if (strcmp(speech, "on") == 0) ttsEnabled = true;

          if (strcmp(vol, "up") == 0) { volumePercent += 12; applyVolume(); }
          if (strcmp(vol, "down") == 0) { volumePercent -= 12; applyVolume(); }

          if (strcmp(kind, "command") == 0 || strcmp(kind, "silent") == 0) out.commandHandled = true;

          Serial.printf("[converse] heard: %s (%s)\n", (const char *)(doc["heard"] | ""), kind);

        }

      } else if (type == 'P' && pngBuf) {

        // Decoded and painted mid-speech — the decoder lives in PSRAM (see
        // decodePngTo), so this no longer competes with the live TLS
        // connection for the internal RAM that used to make these two
        // mutually exclusive.
        if (frame || (frame = (uint16_t *)heap_caps_malloc((size_t)LCD_WIDTH * LCD_HEIGHT * 2, MALLOC_CAP_SPIRAM))) {
          if (decodePngTo(pngBuf, got, frame)) {
            gfx->draw16bitBeRGBBitmap(0, 0, frame, LCD_WIDTH, LCD_HEIGHT);
            state.showingAnswer = true;
            out.gotScreen = true;
          }
        }

        free(pngBuf);
        pngBuf = nullptr;

      } else if (type == 'E') {

        ended = true;
        out.ok = true;

      }

      headGot = 0;

    }

  }

  http.end();

  // Free the ~50KB of internal RAM the TLS context holds; the next exchange
  // pre-connects on the other core anyway.
  exchangeClient.stop();

  if (pngBuf) free(pngBuf);

  // Whatever arrived after the read loop ended still deserves to be heard.
  while (!stopSpeaking && ring.count) {
    if (!playbackStarted) {
      playbackStarted = true;
      drawPhaseCached(PF_SPEAK, "speaking", "tap to stop", C_MOSS);
    }
    if (!pumpAudio()) { out.interrupted = true; break; }
  }

  if (stopSpeaking) out.interrupted = true;

  Serial.printf("[converse] done ok=%d screen=%d interrupted=%d heap=%u\n",
                out.ok, out.gotScreen, out.interrupted, (unsigned)ESP.getFreeHeap());

  return out;

}


void voiceFlow(bool fromWake = false) {

  phase = LISTENING;
  // Unmissable on purpose. Anyone in the room can see the moment this
  // device starts recording, which is the point — a listening indicator that
  // needs explaining is not an indicator.
  drawPhaseCached(PF_LISTEN, "listening", fromWake ? "speak now" : "release to send", C_EMBER);

  // The TLS handshake runs on the other core while the sentence is still
  // being spoken, which deletes it from the perceived response time.
  startPreconnect();

#if WAKE_WORD
  // The detector and the recorder cannot share the I2S stream, so the engine
  // steps aside for the length of the conversation and is restarted after.
  // Paused, not ended.
  //
  // Every question used to tear the engine down and build it back up, which
  // reloads three megabytes of models from flash and allocates the whole AFE
  // again. It worked for the first few and then quietly stopped: the wake
  // word "worked accurately at first, then after a bit of runtime stopped".
  // Pausing keeps the models loaded and the tasks alive.
  //
  // Whenever the engine is armed — not only on a wake. The button path used
  // to leave it running, so the engine and the recorder raced each other for
  // the same samples and each got half a conversation.
  if (micArmed) ESP_SR.pause();
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

    if (rms > SPEECH_RMS) loudFrames++;

    totalFrames++;

  }

  const int loudPercent = totalFrames ? (int)((loudFrames * 100) / totalFrames) : 0;

  Serial.printf("[voice] %u samples, peak %ld, %d%% of frames loud\n",
                (unsigned)samples, (long)peak, loudPercent);

  // At least a tenth of the recording has to contain speech-level energy.
  // Six seconds of room with one cough in it does not reach that; "what is
  // on my calendar" is nowhere near the line.
  // With recording now ending on a pause, a real utterance fills much more
  // of the buffer, so this is a floor against an empty room rather than a
  // judgement about how much of the window was speech.
  const bool heardSpeech = loudPercent >= 5 && peak >= SPEECH_PEAK;

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
  drawThinking(false);

  asksSent++;

  // One connection does the whole conversation: the voice starts as soon as
  // the first quarter-second of speech has arrived, and the composed screen
  // lands mid-sentence as a frame on the same socket.
  const ConverseOutcome result = converse(mono, samples);
  free(mono);

  phase = IDLE;
#if WAKE_WORD
  // Back to listening for the wake word only — never left recording.
  if (micArmed) ESP_SR.resume();
#endif

  // The screen the exchange painted is current; anything else — a handled
  // command, an interruption, a failure — changed state the glass has not
  // seen, so ask for a fresh picture (fresh=1 skips the server's short
  // source cache: this fetch is the direct result of an action).
  if (result.commandHandled || result.interrupted || !result.gotScreen) {
    fetchScreen(true);
  }

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

  // The microphone comes up BEFORE the network, because it does not need it.
  //
  // This used to sit at the end of setup(), after a WiFi wait that returns
  // early when it fails — so a boot with the hotspot asleep left the wake
  // word engine uninitialised, and it stayed that way after the network came
  // back, because reconnecting happens in loop() and only redrew the screen.
  // The device looked fine and could not hear a thing.
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

  connectWiFi();

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

  const bool pollOk = fetchScreen();

  Serial.printf("[boot] first screen fetch: %s\n", pollOk ? "ok" : "FAILED");

  if (!pollOk) drawOffline("could not reach almanac");

  // The four waiting faces, cached while the resting screen is already up —
  // boot pays a few seconds once so every exchange after it never shows the
  // bitmap font again.
  loadPhaseFrames();

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
      // A boot that started offline never cached the waiting faces; the
      // first reconnect is the next chance.
      if (!phaseFrames[PF_LISTEN]) loadPhaseFrames();
      return;
    }

    if (millis() - lastAttempt > 15'000UL) {

      lastAttempt = millis();
      attempts++;

      // Alternate, so a campus password that stopped working does not strand
      // the device and neither does leaving the building.
      const bool useFallback = (attempts % 2) == 0;

      Serial.printf("[wifi] retry %d on %s (status=%d)\n",
                    attempts, useFallback ? WIFI_SSID : WIFI_EAP_SSID, WiFi.status());

      connectWiFi(useFallback);

      char note[72];
      snprintf(note, sizeof(note), "looking for %s", useFallback ? WIFI_SSID : WIFI_EAP_SSID);
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

    // On a composed answer, a tap anywhere means "done with this" — not
    // "mute", which is what the resting face's zones would otherwise have
    // said, and which is a genuinely bad thing to do by accident in a
    // shared room.
    if (state.showingAnswer) {

      // Drawn before the network call, not after. Waiting on a round trip to
      // acknowledge a touch is what made every control feel broken: the tap
      // registered immediately and the glass sat unchanged for two seconds,
      // so it read as a missed press and got pressed again.
      drawPhase("", "putting that away", C_INK_SOFT);

      dismissAnswer();

      state.showingAnswer = false;

      fetchScreen(true);

      delay(250);

      return;

    }

    // The footer strip, split by x into its three controls. These bounds
    // mirror the layout deskScreen.js draws — the two must move together.
    // Left: the voice switch (speech off still answers on the screen).
    // Middle/right: volume down and up, one dot per press.
    if (!state.showingAnswer && t.y >= FOOTER_TOP) {

      if (t.x < 112) {

        ttsEnabled = !ttsEnabled;

        Serial.printf("[tts] %s by button\n", ttsEnabled ? "on" : "off");

      } else if (t.x < 195) {

        volumePercent -= 12;
        applyVolume();

      } else if (t.x < 290) {

        volumePercent += 12;
        applyVolume();

      } else {

        delay(150);
        return;

      }

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
      // resolved in the meantime. fresh, because the nudge count is behind
      // the server's short source cache and this tap just changed it.
      state.nudgeId = "";
      fetchScreen(true);

      delay(300);  // debounce the finger that is still descending

    }

  }

  delay(30);

}
