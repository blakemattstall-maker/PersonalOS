// Types that appear in .ino function signatures.
//
// They live in a header for one reason only: the Arduino build generates
// prototypes for every sketch function and inserts them directly after the
// includes — ABOVE anything defined in the sketch body. A function taking an
// enum or returning a struct defined in the .ino therefore gets a prototype
// that references a type that does not exist yet, and the build fails with a
// baffling "cannot be used as a function". Types in a header are already in
// scope when the prototypes land.
#pragma once

// The cached waiting faces, in fetch order.
enum PhaseFrame { PF_LISTEN = 0, PF_THINK, PF_THINK2, PF_SPEAK, PF_COUNT };

// What one streaming exchange reported back.
struct ConverseOutcome {
  bool ok = false;
  bool gotScreen = false;
  bool interrupted = false;
  bool commandHandled = false;
  // The server's follow-up gate judged the utterance to be noise and did
  // nothing — the device must equally do nothing.
  bool ignored = false;
};
