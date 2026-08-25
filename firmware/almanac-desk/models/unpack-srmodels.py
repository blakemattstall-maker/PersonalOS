# Swap the wake word in a prebuilt srmodels.bin.
#
# The Arduino core ships one WakeNet model, "Hi ESP". Espressif publish a
# free "Jarvis" model of the same generation (wn9) in esp-sr, but not in the
# packaged blob. Rather than rebuild every model from upstream — which risks
# pairing a model format with a mismatched engine — this unpacks the blob the
# core already ships, replaces ONLY the wakenet directory, and repacks with
# Espressif's own packer. Everything else stays byte-identical to what was
# known to work.

import os, struct, sys, shutil

SRC = sys.argv[1]
OUT_DIR = sys.argv[2]


def unpack(path, out_dir):

    with open(path, "rb") as f:
        blob = f.read()

    (model_num,) = struct.unpack_from("I", blob, 0)
    off = 4

    models = {}

    for _ in range(model_num):
        name = blob[off:off + 32].split(b"\x00")[0].decode()
        off += 32
        (file_num,) = struct.unpack_from("I", blob, off)
        off += 4
        files = {}
        for _ in range(file_num):
            fname = blob[off:off + 32].split(b"\x00")[0].decode()
            off += 32
            start, length = struct.unpack_from("II", blob, off)
            off += 8
            files[fname] = blob[start:start + length]
        models[name] = files

    for name, files in models.items():
        d = os.path.join(out_dir, name)
        os.makedirs(d, exist_ok=True)
        for fname, data in files.items():
            with open(os.path.join(d, fname), "wb") as f:
                f.write(data)

    return list(models.keys())


if os.path.isdir(OUT_DIR):
    shutil.rmtree(OUT_DIR)
os.makedirs(OUT_DIR)

names = unpack(SRC, OUT_DIR)

print("unpacked models:", names)

for n in names:
    files = os.listdir(os.path.join(OUT_DIR, n))
    print(f"  {n}: {files}")
