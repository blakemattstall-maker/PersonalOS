#!/usr/bin/env bash
#
# Make "Jarvis" survive a reflash.
#
# The esp_sr_16 partition scheme re-flashes srmodels.bin on EVERY upload:
#
#   esp32s3.menu.PartitionScheme.esp_sr_16.upload.extra_flags=
#       0xC10000 {build.path}/srmodels.bin
#
# and a platform.txt hook copies the stock blob out of the SDK into the build
# directory each time it compiles. So flashing a custom wake word by hand with
# esptool works exactly until the next sketch upload silently overwrites it —
# which is what happened here: the device kept reporting it had loaded
# "Hi,ESP" while everything above it had been rebuilt around Jarvis.
#
# The fix is to change what the hook copies FROM. This puts the Jarvis blob in
# the SDK location, keeping the original beside it, so every future upload
# flashes the right model without anyone having to remember a manual step.
#
# Idempotent: run it as often as you like.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SDK_DIR="${SDK_DIR:-$HOME/Library/Arduino15/packages/esp32/tools/esp32s3-libs/3.3.11/esp_sr}"

TARGET="$SDK_DIR/srmodels.bin"
BACKUP="$SDK_DIR/srmodels.stock.bin"
SOURCE="$HERE/srmodels-jarvis.bin"

[ -f "$SOURCE" ] || { echo "missing $SOURCE"; exit 1; }
[ -d "$SDK_DIR" ] || { echo "no esp-sr SDK dir at $SDK_DIR (set SDK_DIR=)"; exit 1; }

# Keep the untouched original exactly once, so this is reversible.
if [ ! -f "$BACKUP" ]; then
  cp "$TARGET" "$BACKUP"
  echo "backed up stock blob -> $BACKUP"
fi

cp "$SOURCE" "$TARGET"

echo "installed Jarvis model -> $TARGET"
echo
echo "verify after the next upload; the device prints its model on boot:"
echo "  MC Quantized wakenet9: wakenet9l_tts1h8_Jarvis..."
echo
echo "to revert:  cp \"$BACKUP\" \"$TARGET\""
