#!/usr/bin/env bash
#
# Recipe -> render -> atlas -> manifest, in one command, for the EffectCraft
# flipbooks in `tools/effectcraft/`.
#
# Two things this script owns that the manual route got wrong:
#
#   1. EffectCraft writes its PNG sequence as `f_%05d_00000.png` — the pattern
#      stays in the filename literally, so ffmpeg cannot read it back. The
#      sequence is renamed to `m_00000.png` before encoding.
#   2. Passing `--generator "… build.json + tools/make-flipbook-atlas.ts"` makes
#      the atlas builder append its own suffix twice. This script passes only the
#      version and the recipe; the builder appends the rest.
#
# The atlas builder refuses a sheet with an empty frame, and this script prints
# the per-frame alpha coverage before packing: a burst whose first or last frame
# carries nothing blinks out mid-life and reads as a bug in the game.
set -euo pipefail

usage() {
  cat <<'EOF'
usage: tools/effectcraft/bake.sh <recipe.build.json> <atlas_name> \
         --cell N --cols N --rows N [--src N] [--frame-rate N] [--every N] [--keep]

  --cell        cell size in the sheet; must match the renderer's constant
  --cols/--rows sheet grid; cols x rows must equal the frames you keep
  --src         comp size the recipe renders at (default 256)
  --frame-rate  render frame rate (default 30)
  --every       keep every Nth rendered frame (death cloud and dust ship half)
  --keep        leave the work directory behind for inspection

example:
  tools/effectcraft/bake.sh tools/effectcraft/melee_swipe.build.json melee_atlas \
    --cell 128 --cols 5 --rows 2
EOF
}

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$REPO"

if [ "$#" -lt 2 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  usage
  exit 2
fi

RECIPE=$1
NAME=$2
shift 2

SRC=256
CELL=""
COLS=""
ROWS=""
FRAME_RATE=30
EVERY=""
OFFSET=0
KEEP=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --cell) CELL=$2; shift 2 ;;
    --cols) COLS=$2; shift 2 ;;
    --rows) ROWS=$2; shift 2 ;;
    --src) SRC=$2; shift 2 ;;
    --frame-rate) FRAME_RATE=$2; shift 2 ;;
    --every) EVERY=$2; shift 2 ;;
    # Start sampling at frame N: the noise ring shipped frames 1, 5, 9… of a
    # 30 frame render, and without this the sheet comes out one frame off.
    --offset) OFFSET=$2; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h | --help) usage; exit 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$CELL" ] || [ -z "$COLS" ] || [ -z "$ROWS" ]; then
  echo "--cell, --cols and --rows are required (they must match the renderer's constants)" >&2
  exit 2
fi
if [ ! -f "$RECIPE" ]; then
  echo "no such recipe: $RECIPE" >&2
  exit 2
fi

for bin in effectcraft-cli ffmpeg python3; do
  command -v "$bin" >/dev/null || { echo "missing $bin on PATH" >&2; exit 2; }
done
FB=$(command -v ffmpeg)

read -r COMP DURATION <<<"$(python3 - "$RECIPE" <<'PY'
import json, sys
steps = json.load(open(sys.argv[1]))
comp = next(s for s in steps if s["command"] == "comp.new")["params"]
print(comp["name"], comp.get("duration", 1.0))
PY
)"
EC_VER=$(effectcraft-cli --version | awk '{print $2}')

WORK=$(mktemp -d "${TMPDIR:-/tmp}/afterfall-bake-XXXXXX")
cleanup() { [ -n "$KEEP" ] || rm -rf "$WORK"; }
trap cleanup EXIT
mkdir -p "$WORK/frames" "$WORK/seq" "$WORK/packed"

echo "== recipe   $RECIPE (comp $COMP, ${DURATION}s, EffectCraft $EC_VER)"
echo "== workdir  $WORK"

# The shipped sha, read before anything writes. Reading it after the packer ran
# would compare the new file with the entry the packer had just written, and the
# answer would always be "reproducible" — which is exactly how a false claim
# reaches a report.
OLD=$(python3 - "$NAME" <<'PY'
import json, sys
manifest = json.load(open("apps/web/public/art/manifest.json"))
print(next((a["sha256"] for a in manifest["assets"] if a["name"] == sys.argv[1]), "missing"))
PY
)

# The CLI is stateless per invocation and the recipe ends in `file.save`, so one
# `run` both builds the comp and writes the project the next step renders from.
(cd "$WORK" && effectcraft-cli run --commands "$REPO/$RECIPE" >/dev/null)
[ -f "$WORK/$COMP.ecproj" ] || { echo "the recipe did not save $COMP.ecproj" >&2; exit 1; }

echo "== render   ${SRC}x${SRC} at $FRAME_RATE fps"
(cd "$WORK" && effectcraft-cli render --comp "$COMP" --format png --channels rgba \
  --fps "$FRAME_RATE" --start 0 --end "$DURATION" \
  --out "$WORK/frames/f_%05d.png" "$COMP.ecproj" >/dev/null)

# `f_%05d_00000.png`: the pattern is part of the name. Rename to a sequence
# ffmpeg reads, keeping every Nth frame when asked.
i=0
kept=0
for f in $(ls "$WORK"/frames/f_*.png | sort -V); do
  if [ "$i" -lt "$OFFSET" ]; then i=$((i + 1)); continue; fi
  if [ -n "$EVERY" ] && [ $(((i - OFFSET) % EVERY)) -ne 0 ]; then i=$((i + 1)); continue; fi
  printf -v out "m_%05d.png" "$kept"
  cp "$f" "$WORK/seq/$out"
  kept=$((kept + 1))
  i=$((i + 1))
done
WANT=$((COLS * ROWS))
if [ "$kept" -ne "$WANT" ]; then
  echo "kept $kept frames but the sheet needs $WANT (cols x rows): adjust --every or the duration" >&2
  exit 1
fi
echo "== frames   $kept of $i rendered"

"$FB" -v error -y -framerate "$FRAME_RATE" -i "$WORK/seq/m_%05d.png" -frames:v "$kept" \
  -f rawvideo -pix_fmt rgba "$WORK/packed/$NAME.raw"

python3 - "$WORK/packed/$NAME.raw" "$SRC" "$kept" <<'PY'
import sys
raw = open(sys.argv[1], "rb").read()
side, frames = int(sys.argv[2]), int(sys.argv[3])
pixels = side * side
cov = []
for f in range(frames):
    alpha = raw[f * pixels * 4 + 3 : (f + 1) * pixels * 4 : 4]
    cov.append(100 * sum(1 for a in alpha if a >= 8) / pixels)
print("== coverage " + " ".join(f"{c:.1f}" for c in cov) + " (%)")
print(f"== peak {max(cov):.1f}%  first {cov[0]:.1f}%  last {cov[-1]:.1f}%")
PY

pnpm exec tsx tools/make-flipbook-atlas.ts "$NAME" "$WORK/packed/$NAME.raw" \
  --src "$SRC" --cell "$CELL" --cols "$COLS" --rows "$ROWS" \
  --generator "EffectCraft $EC_VER $RECIPE"
pnpm exec prettier --write apps/web/public/art/manifest.json >/dev/null

NEW=$(sha256sum "apps/web/public/art/$NAME.png" | cut -d' ' -f1)
echo "== atlas    $NAME.png $(stat -c%s "apps/web/public/art/$NAME.png") bytes, sha256 $NEW"
if [ "$NEW" = "$OLD" ]; then
  echo "== reproducible: this rebuild matches the shipped atlas byte for byte"
else
  echo "== changed from ${OLD:0:12}…: review the atlas and the manifest diff"
fi
echo "== next     pnpm assets:check && pnpm test"
