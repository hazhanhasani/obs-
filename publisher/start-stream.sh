#!/bin/sh
set -eu

MODE="${STREAM_MODE:-test}"
PATH_NAME="${STREAM_PATH:-main}"
INPUT="${INPUT_FILE:-/media/loop.mp4}"

case "$PATH_NAME" in
  ""|*[!a-zA-Z0-9_-]*)
    echo "Invalid STREAM_PATH; use letters, digits, underscore or hyphen." >&2
    exit 2
    ;;
esac

TARGET="rtmp://mediamtx:1935/$PATH_NAME"

if [ "$MODE" = "test" ]; then
  exec ffmpeg -nostdin -hide_banner -loglevel info \
    -re -f lavfi -i "testsrc2=size=1280x720:rate=25" \
    -f lavfi -i "sine=frequency=440:sample_rate=48000" \
    -c:v libx264 -preset ultrafast -tune zerolatency \
    -pix_fmt yuv420p -g 50 -b:v 1500k -maxrate 1500k -bufsize 3000k \
    -c:a aac -ar 48000 -b:a 96k -f flv "$TARGET"
elif [ "$MODE" = "file" ]; then
  if [ ! -f "$INPUT" ]; then
    echo "File not found: $INPUT. Add an H.264 MP4 at media/loop.mp4." >&2
    exit 3
  fi

  exec ffmpeg -nostdin -hide_banner -loglevel info \
    -re -stream_loop -1 -i "$INPUT" \
    -map 0:v:0 -map 0:a? -c:v copy -c:a aac -b:a 128k \
    -f flv "$TARGET"
else
  echo "Unknown STREAM_MODE: $MODE" >&2
  exit 2
fi
