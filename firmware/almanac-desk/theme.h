// The Almanac palette, in RGB565. Same tokens as the web app's globals.css,
// same rule: ember means exactly one thing — something is waiting on you.
// When the queue is clear there is no orange on this screen at all.
#pragma once

// Converted from the app's hex palette (RGB888 -> RGB565, >>3 / >>2 / >>3).
#define C_PAPER    0xEF7D  // #efeee9
#define C_INK      0x3209  // #37424a
#define C_INK_SOFT 0x5B4E  // #5c6a73
#define C_LINE     0xBE17  // #b9c0bf
#define C_MOSS     0x4B4C  // #4a6b62
#define C_EMBER    0xE387  // #e07038  — reserved: only when something waits
#define C_TIDE     0x4351  // #47698c
#define C_BLACK    0x0000
#define C_WHITE    0xFFFF
