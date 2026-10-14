#!/usr/bin/env bash
set -euo pipefail

echo "==> Generating AppIcon.icns from assets/icon.svg..."

# If librsvg is available, use rsvg-convert; otherwise fallback to brew / qlmanage
if ! command -v rsvg-convert &> /dev/null; then
  if command -v brew &> /dev/null; then
    echo "Installing librsvg via Homebrew..."
    brew install librsvg
  elif command -v qlmanage &> /dev/null; then
    qlmanage -t -s 1024 -o . assets/icon.svg
    mv icon.svg.png icon_1024.png
  else
    echo "Error: Neither rsvg-convert nor brew/qlmanage found." >&2
    exit 1
  fi
fi

if [ ! -f icon_1024.png ]; then
  rsvg-convert -w 1024 -h 1024 assets/icon.svg -o icon_1024.png
fi

mkdir -p AppIcon.iconset
sips -z 16 16     icon_1024.png --out AppIcon.iconset/icon_16x16.png
sips -z 32 32     icon_1024.png --out AppIcon.iconset/icon_16x16@2x.png
sips -z 32 32     icon_1024.png --out AppIcon.iconset/icon_32x32.png
sips -z 64 64     icon_1024.png --out AppIcon.iconset/icon_32x32@2x.png
sips -z 128 128   icon_1024.png --out AppIcon.iconset/icon_128x128.png
sips -z 256 256   icon_1024.png --out AppIcon.iconset/icon_128x128@2x.png
sips -z 256 256   icon_1024.png --out AppIcon.iconset/icon_256x256.png
sips -z 512 512   icon_1024.png --out AppIcon.iconset/icon_256x256@2x.png
sips -z 512 512   icon_1024.png --out AppIcon.iconset/icon_512x512.png
sips -z 1024 1024 icon_1024.png --out AppIcon.iconset/icon_512x512@2x.png

iconutil -c icns AppIcon.iconset -o AppIcon.icns
rm -rf AppIcon.iconset icon_1024.png

echo "==> Successfully generated AppIcon.icns"
