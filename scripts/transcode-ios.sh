#!/bin/bash
# 把 assets/voice/*.mp3 全部转成 iOS WebView 兼容的标准 mp3
# 标准：44.1kHz / 立体声 / 128kbps CBR / 标准 Xing 头
set -e
cd "$(dirname "$0")/../assets/voice" || exit 1
shopt -s nullglob
count=0
for f in *.mp3; do
  tmp="${f}.tmp.mp3"
  ffmpeg -y -i "$f" -ar 44100 -ac 2 -b:a 128k -codec:a libmp3lame -write_xing 1 -id3v2_version 3 -loglevel error "$tmp"
  mv -f "$tmp" "$f"
  count=$((count+1))
done
echo "转码完成 $count 个"
echo "---验证采样率---"
ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate,channels -of default=noprint_wrappers=1 encourage-1.mp3
