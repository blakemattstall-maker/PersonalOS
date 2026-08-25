// Pin map for the Waveshare ESP32-S3-Touch-AMOLED-1.8, verified against the
// board's official sources rather than guessed:
//   https://github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.8
//     examples/arduino/libraries/Mylibrary/pin_config.h
//   https://github.com/waveshareteam/Waveshare-ESP32-components
//     bsp/esp32_s3_touch_amoled_1_8/include/bsp/esp32_s3_touch_amoled_1_8.h
//
// Two hardware revisions exist and are told apart by the label on the board:
// V1 = SH8601 display + FT3168 touch (what the Aug 2026 Amazon listing ships),
// V2 = CO5300 display + CST820 touch, with a 16-pixel X offset. Set the flag
// before flashing; everything else is identical between revisions.
#pragma once

// Set to 1 for V2 boards (CO5300 display + CST816 touch), 0 for V1 (SH8601 +
// FT3168). Do not trust the Amazon listing title for this: the Aug 2026
// listing advertises "SH8601 + FT3168" and shipped a V2 board. The firmware
// probes the touch address at boot and prints a loud MISMATCH if this flag
// disagrees with the silicon — believe the probe, not the box.
#define AMOLED_V2 1

// AMOLED over QSPI. Reset is NOT on an ESP32 pin — the panel's reset, the
// display power rail and the touch reset all live on a TCA9554 IO expander
// (see tca9554.h), which is why the expander dance in setup() is mandatory.
#define LCD_CS     12
#define LCD_SCLK   11
#define LCD_SDIO0  4
#define LCD_SDIO1  5
#define LCD_SDIO2  6
#define LCD_SDIO3  7
#define LCD_WIDTH  368
#define LCD_HEIGHT 448

// One shared I2C bus: touch, codec, IMU, RTC, PMU, expander.
#define IIC_SDA 15
#define IIC_SCL 14
#define TP_INT  21

// ES8311 codec. The vendor pin_config.h carries a legacy block with DI/DO
// swapped; the BSP and the working echo demo settle it: 8 is data OUT to the
// codec (speaker), 10 is data IN from the mic.
#define I2S_MCK_IO 16
#define I2S_BCK_IO 9
#define I2S_WS_IO  45
#define I2S_DO_IO  8
#define I2S_DI_IO  10
#define PA_PIN     46

// I2C addresses on the shared bus.
#define ADDR_EXPANDER 0x20  // TCA9554
#define ADDR_TOUCH_V1 0x38  // FT3168 (FT6x36-compatible registers)
#define ADDR_TOUCH_V2 0x15  // CST820 (CST816-compatible registers)

// The BOOT button is a real user button at runtime (active low). The PWR
// button is NOT on a GPIO — it is sensed on the expander's EXIO4.
#define BOOT_BTN 0
