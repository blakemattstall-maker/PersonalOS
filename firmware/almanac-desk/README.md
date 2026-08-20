# Almanac desk companion

Firmware for the Waveshare **ESP32-S3-Touch-AMOLED-1.8** (V1: SH8601 + FT3168).
Polls `/api/desk` for the ember/clear state, next-event countdown, brief lead
and current nudge; tap the nudge to resolve it; hold the bottom bar or the
side BOOT button to talk to Almanac (`/api/capture`) and hear the reply
(`/api/tts`, streamed as WAV — no audio decoder on-device).

## One-time setup

1. Copy `secrets.h.example` to `secrets.h` and fill in WiFi (2.4GHz only,
   no eduroam), the deployment URL, and the API key. `secrets.h` is
   gitignored — this repo is public.
2. Board revision: the sticker/silkscreen on the board says V1 or V2. V2
   needs `#define AMOLED_V2 1` in `pins.h`. The Aug 2026 Amazon listing
   (SH8601 + FT3168 in the title) is V1 — leave the flag at 0.

## Build

Arduino core **esp32 3.x** (CI-verified against 3.3.11 by Waveshare) and two
registry libraries:

- `GFX Library for Arduino` (Arduino_GFX) **1.6.7 or newer** — has SH8601 and
  CO5300. Waveshare's demos bundle 1.6.4, but that version fails to compile
  against core 3.3.x (its ESP32SPI files predate an SPI HAL signature change);
  1.6.7 builds clean. Verified by compiling this sketch.
- `ArduinoJson`

The ES8311 codec driver (Apache-2.0, Espressif) is vendored in this folder,
taken from Waveshare's official demo — do not "update" it from upstream ESP-IDF;
this copy is the Arduino-HAL port that matches this board.

### arduino-cli

```bash
arduino-cli core install esp32:esp32
arduino-cli lib install "GFX Library for Arduino" ArduinoJson
arduino-cli compile --fqbn "esp32:esp32:esp32s3:CDCOnBoot=cdc,PSRAM=opi,FlashSize=16M,PartitionScheme=app3M_fat9M_16MB" firmware/almanac-desk
arduino-cli upload -p /dev/cu.usbmodem* --fqbn "esp32:esp32:esp32s3:CDCOnBoot=cdc,PSRAM=opi,FlashSize=16M,PartitionScheme=app3M_fat9M_16MB" firmware/almanac-desk
arduino-cli monitor -p /dev/cu.usbmodem* -c baudrate=115200
```

### Arduino IDE equivalents (Tools menu)

Board "ESP32S3 Dev Module" · USB CDC On Boot: **Enabled** · PSRAM: **OPI
PSRAM** · Flash Size: **16MB** · Partition Scheme: 16M flash (3MB APP).
Wrong PSRAM/flash settings are the classic "compiles, then crashes at boot".

## Hardware truths (verified from Waveshare's official sources)

- The panel/touch resets and display power rail live on a **TCA9554 expander**
  at I2C 0x20 — `tca9554::begin()` must run before touch works. The screen
  itself usually lights without it (hardware pull-ups).
- ES8311 codec at 0x18; I2S pins MCLK 16 / BCLK 9 / WS 45 / **out 8 / mic in
  10** (the vendor pin_config.h has a legacy block with those two swapped —
  the BSP and working echo demo agree on this orientation). PA enable GPIO46.
- BOOT button = GPIO0 (usable at runtime). The PWR button is on expander
  EXIO4, not a GPIO.
- Exposed pads for later (radar etc.): GPIO 17/18/38/39/40/41/42, UART0
  TX/RX (43/44), and the shared I2C (14/15). 1.27mm pitch — fine-tip solder.
- Board **requires the 3.7V MX1.25 battery** per Waveshare; check polarity
  against the silkscreen before plugging one in.

## First-flash checklist

USB-C **data** cable → the port enumerates as `/dev/cu.usbmodem*`. If upload
fails, hold BOOT while tapping reset (or replug holding BOOT) to force the
bootloader. Serial monitor shows every HTTP status the firmware sees.
