#!/bin/bash
# admi-roster-export の全画像を Upscayl(ultramix-balanced-4x) で高画質化し、
# 各女の子を3枚に揃える（1枚しかなければ同じ画像を1/2/3に複製、2枚なら循環で3枚目を補完）。
# 出力: admi-roster-hq/  (girls.csv はコピー)
set -e

UB="/Applications/Upscayl.app/Contents/Resources/bin/upscayl-bin"
MODELS="/Applications/Upscayl.app/Contents/Resources/models"
BASE="/Users/biyobu/Desktop/deri-hotel-navi/astro-kichifu/scripts"
SRC="$BASE/admi-roster-export"
IN="/tmp/roster_hq_in"
OUT="$BASE/admi-roster-hq"
LOG="$BASE/upscale-roster.log"

echo "[$(date '+%H:%M:%S')] start" > "$LOG"

rm -rf "$IN" "$OUT"
mkdir -p "$IN" "$OUT"

# 画像だけを入力ディレクトリへ（girls.csv を除外）
cp "$SRC"/g*.jpg "$IN"/
echo "[$(date '+%H:%M:%S')] input images: $(ls "$IN" | wc -l | tr -d ' ')" >> "$LOG"

# Upscayl バッチ（モデル読込1回）。4x で出力後、取り込み側で960x1280に縮小される
"$UB" -i "$IN" -o "$OUT" -s 4 -m "$MODELS" -n ultramix-balanced-4x -f jpg >> "$LOG" 2>&1

echo "[$(date '+%H:%M:%S')] upscaled: $(ls "$OUT"/*.jpg 2>/dev/null | wc -l | tr -d ' ')" >> "$LOG"

# 各 img_key を3枚に補完（循環コピー）
keys=$(ls "$OUT"/g*_*.jpg | sed -E 's#.*/##; s/_[0-9]+\.jpg$//' | sort -u)
for key in $keys; do
  imgs=( $(ls "$OUT/${key}"_*.jpg 2>/dev/null | sort) )
  n=${#imgs[@]}
  [ "$n" -ge 3 ] && continue
  for slot in 1 2 3; do
    target="$OUT/${key}_${slot}.jpg"
    [ -f "$target" ] && continue
    idx=$(( (slot - 1) % n ))
    cp "${imgs[$idx]}" "$target"
  done
done

cp "$SRC/girls.csv" "$OUT/girls.csv"

echo "[$(date '+%H:%M:%S')] DONE. total images: $(ls "$OUT"/g*_*.jpg | wc -l | tr -d ' ')" >> "$LOG"
echo "[$(date '+%H:%M:%S')] 全員3枚確認: $(ls "$OUT"/g*_3.jpg | wc -l | tr -d ' ')/103" >> "$LOG"
