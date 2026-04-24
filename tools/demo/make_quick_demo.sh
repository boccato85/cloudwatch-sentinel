#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${DEMO_BASE_URL:-http://127.0.0.1:8080}"
OUT_DIR="${DEMO_OUT_DIR:-docs/assets/demo}"
PW_NODE_MODULES="${PLAYWRIGHT_NODE_MODULES:-/tmp/sentinel-demo-capture/node_modules}"
TMP_LOG="$(mktemp)"

mkdir -p "$OUT_DIR"

NODE_PATH="$PW_NODE_MODULES" DEMO_BASE_URL="$BASE_URL" DEMO_OUT_DIR="$OUT_DIR" \
  node tools/demo/capture_quick_demo.cjs | tee "$TMP_LOG"

FRAMES_DIR="$(awk -F= '/^FRAMES_DIR=/{print $2}' "$TMP_LOG" | tail -n1)"
rm -f "$TMP_LOG"

if [[ -z "$FRAMES_DIR" || ! -d "$FRAMES_DIR" ]]; then
  echo "Could not find frames directory" >&2
  exit 1
fi

ffmpeg -y -framerate 0.8 -pattern_type glob -i "$FRAMES_DIR/*.png" \
  -vf "scale=1280:-2:flags=lanczos,format=yuv420p" \
  "$OUT_DIR/sentinel-quick-demo.mp4" >/dev/null 2>&1

ffmpeg -y -framerate 0.8 -pattern_type glob -i "$FRAMES_DIR/*.png" \
  -vf "fps=8,scale=1100:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  "$OUT_DIR/sentinel-quick-demo.gif" >/dev/null 2>&1

echo "Generated: $OUT_DIR/sentinel-quick-demo.mp4"
echo "Generated: $OUT_DIR/sentinel-quick-demo.gif"
