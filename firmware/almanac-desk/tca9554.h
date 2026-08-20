// Minimal TCA9554 IO-expander driver — 3 registers, no library.
//
// This chip is not optional plumbing: the AMOLED's reset (EXIO0), the display
// power rail (EXIO1) and the touch reset (EXIO2) hang off it, so touch will
// not enumerate until these are pulsed low then released. Sequence copied
// from the official 04_GFX_FT3168_Image demo. EXIO4 is the PWR button
// (input, active high); EXIO7 is the SD chip select.
#pragma once

#include <Wire.h>
#include "pins.h"

namespace tca9554 {

  const uint8_t REG_INPUT = 0x00;
  const uint8_t REG_OUTPUT = 0x01;
  const uint8_t REG_CONFIG = 0x03;  // bit=1 input, bit=0 output

  inline void writeReg(uint8_t reg, uint8_t value) {
    Wire.beginTransmission(ADDR_EXPANDER);
    Wire.write(reg);
    Wire.write(value);
    Wire.endTransmission();
  }

  inline uint8_t readReg(uint8_t reg) {
    Wire.beginTransmission(ADDR_EXPANDER);
    Wire.write(reg);
    Wire.endTransmission(false);
    Wire.requestFrom((int)ADDR_EXPANDER, 1);
    return Wire.available() ? Wire.read() : 0xFF;
  }

  // Release the panel/touch resets. Returns false if the expander never ACKed
  // — which on this board means the I2C bus itself is wrong.
  inline bool begin() {

    Wire.beginTransmission(ADDR_EXPANDER);
    if (Wire.endTransmission() != 0) return false;

    // EXIO0..2 outputs, EXIO4 input (PWR button), rest outputs.
    writeReg(REG_CONFIG, 0b00010000);

    // Reset pulse: low 20ms, then high, then let the panel wake.
    writeReg(REG_OUTPUT, 0b00000000);
    delay(20);
    writeReg(REG_OUTPUT, 0b11101111);
    delay(150);

    return true;

  }

  inline bool powerButtonPressed() {
    return (readReg(REG_INPUT) & 0b00010000) != 0;  // EXIO4, active high
  }

}
