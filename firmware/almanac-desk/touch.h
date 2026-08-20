// Minimal capacitive-touch poll — no library, one I2C read per loop.
//
// V1 boards carry an FT3168, which answers the FT6x36 register map:
// 0x02 = number of touches, 0x03..0x06 = first touch X/Y (12-bit, high
// nibbles in the even registers). V2 boards carry a CST820, which answers
// the CST816 map: 0x02 = touches, 0x03..0x06 = X/Y the same way but with
// different high-nibble masks. Both are handled; pins.h's AMOLED_V2 picks.
#pragma once

#include <Wire.h>
#include "pins.h"

struct TouchPoint {
  bool touched = false;
  int16_t x = 0;
  int16_t y = 0;
};

inline TouchPoint readTouch() {

  TouchPoint p;

  const uint8_t addr = AMOLED_V2 ? ADDR_TOUCH_V2 : ADDR_TOUCH_V1;

  Wire.beginTransmission(addr);
  Wire.write(0x02);
  if (Wire.endTransmission(false) != 0) return p;

  if (Wire.requestFrom((int)addr, 5) != 5) return p;

  const uint8_t touches = Wire.read() & 0x0F;
  const uint8_t xh = Wire.read(), xl = Wire.read();
  const uint8_t yh = Wire.read(), yl = Wire.read();

  if (touches == 0 || touches > 2) return p;

  p.touched = true;
  p.x = ((xh & 0x0F) << 8) | xl;
  p.y = ((yh & 0x0F) << 8) | yl;

  return p;

}
