#!/usr/bin/env bash
#
# Compile, flash, and watch — one command.
#
# The port number changes between plug-ins (usbmodem1101, usbmodem2101, ...),
# which cost a failed upload every time it was typed from memory. This finds
# whichever one is present.
#
#   ./firmware/almanac-desk/flash.sh          compile, upload, tail serial
#   ./firmware/almanac-desk/flash.sh --watch  just tail serial
#
# Note: reading the serial port needs the shell sandbox disabled. Flashing
# does not.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKETCH="$HERE"

FQBN="esp32:esp32:esp32s3:CDCOnBoot=cdc,PSRAM=opi,FlashSize=16M,PartitionScheme=esp_sr_16"

CLI="${ARDUINO_CLI:-arduino-cli}"
command -v "$CLI" >/dev/null 2>&1 || CLI="/private/tmp/claude-501/-Users-blakestall-PersonalOS/0301e911-6bd6-4e00-9d7d-4fd3cf04cd62/scratchpad/bin/arduino-cli"

PORT="$(ls /dev/cu.usbmodem* 2>/dev/null | head -1 || true)"

if [ -z "$PORT" ]; then
  echo "No board found. Plug it in over USB-C (a DATA cable) and try again."
  exit 1
fi

echo "board on $PORT"

if [ "${1:-}" != "--watch" ]; then

  echo "compiling..."
  "$CLI" compile --fqbn "$FQBN" "$SKETCH" 2>&1 | grep -E "error|Sketch uses" || true

  echo "uploading..."
  "$CLI" upload -p "$PORT" --fqbn "$FQBN" "$SKETCH" >/tmp/desk-upload.log 2>&1 \
    || { echo "upload failed:"; tail -5 /tmp/desk-upload.log; exit 1; }

  # The wake word model rides along with every upload; confirm which one.
  grep -c "srmodels" /tmp/desk-upload.log >/dev/null && echo "model partition written"

  echo "uploaded."

fi

echo "--- serial (ctrl-c to stop) ---"
cat "$PORT"
