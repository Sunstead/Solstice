#!/usr/bin/env bash
# Builds the macOS app icon from the Icon Composer document.
#
#   src/assets/icons/app/mac.icon  ->  src-tauri/icons/Assets.car  (Liquid Glass, macOS 26+)
#                                  ->  src-tauri/icons/icon.icns   (flat fallback, older macOS)
#
# Needs Xcode 26+ (actool) and Icon Composer (ictool); the App icons workflow
# runs it on GitHub's macOS runners. Outputs are committed, so this only needs
# re-running when the icon changes. The other platforms' icons come from
# scripts/build-icons.mjs. Ported from Cosmos.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC=src/assets/icons/app/mac.icon
OUT=src-tauri/icons
ICTOOL="${ICTOOL:-/Applications/Icon Composer.app/Contents/Executables/ictool}"
[ -x "$ICTOOL" ] || ICTOOL="$(xcode-select -p)/../Applications/Icon Composer.app/Contents/Executables/ictool"
[ -x "$ICTOOL" ] || { echo "ictool not found; install Icon Composer or set ICTOOL" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Liquid Glass asset catalog. The icon name ("mac", from mac.icon) must match
# CFBundleIconName in src-tauri/Info.plist.
mkdir -p "$tmp/car"
xcrun actool "$SRC" --compile "$tmp/car" \
  --app-icon mac --include-all-app-icons \
  --platform macosx --target-device mac --minimum-deployment-target 11.0 \
  --output-partial-info-plist "$tmp/partial.plist" \
  --enable-on-demand-resources NO --development-region en \
  --errors --warnings --output-format human-readable-text >/dev/null
cp "$tmp/car/Assets.car" "$OUT/Assets.car"

# Full-size flat renders for the .icns (actool's own fallback stops at 256px).
# ictool renders edge to edge, so each size is drawn at the macOS icon grid
# (824 of 1024) and padded with transparency to match other apps in the Dock.
# Light angle 0 lights the top edge, as the system does for the glass icon.
set_dir="$tmp/icon.iconset"
mkdir -p "$set_dir"
for size in 16 32 128 256 512; do
  for scale in 1 2; do
    px=$(( size * scale ))
    body=$(( (px * 824 + 512) / 1024 ))
    suffix=""
    if [ "$scale" = 2 ]; then suffix="@2x"; fi
    file="$set_dir/icon_${size}x${size}${suffix}.png"
    "$ICTOOL" "$SRC" --export-image --output-file "$tmp/body.png" \
      --platform macOS --rendition Default --width "$body" --height "$body" --scale 1 \
      --light-angle 0 >/dev/null
    sips --padToHeightWidth "$px" "$px" "$tmp/body.png" --out "$file" >/dev/null
  done
done
iconutil -c icns "$set_dir" -o "$OUT/icon.icns"

echo "wrote $OUT/Assets.car and $OUT/icon.icns"
