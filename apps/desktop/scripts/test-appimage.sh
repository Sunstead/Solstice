#!/usr/bin/env bash
# Runs a Solstice AppImage the way an Arch Linux user would, in a container with
# a virtual display, and fails if the window comes up blank. Works from a Mac
# (Docker Desktop) or any Linux; picks the image for this machine's architecture,
# so give it the matching AppImage (aarch64 on Apple Silicon, amd64 on Intel).
#
#   apps/desktop/scripts/test-appimage.sh Solstice_0.9.0_aarch64.AppImage [out-dir]
#
# Writes screenshot.png and app.log to out-dir (default ./appimage-test).
# Arch is a rolling release, so it's the quickest way to meet the newest Mesa
# and WebKitGTK: the 0.9.0 AppImage's blank gray window (a bundled libwayland
# older than Mesa's EGL wants) shows up here as "Could not create default EGL
# display". There's no GPU in the container, so this checks that the app starts
# and draws, not how fast.
set -euo pipefail

appimage=${1:?usage: test-appimage.sh <file.AppImage> [out-dir]}
out=${2:-./appimage-test}
mkdir -p "$out"
appimage=$(realpath "$appimage")
out=$(realpath "$out")

case "$(uname -m)" in
  arm64 | aarch64) platform=linux/arm64; image=menci/archlinuxarm ;;
  *) platform=linux/amd64; image=archlinux ;;
esac

docker run --rm -i --platform "$platform" \
  -v "$appimage":/app/solstice.AppImage:ro \
  -v "$out":/out \
  -e "APP_ENV=${APP_ENV:-}" \
  "$image" bash -s <<'EOF'
set -u
# pacman's own sandbox needs Landlock, which Docker Desktop's kernel lacks.
sed -i 's/^#DisableSandbox/DisableSandbox/' /etc/pacman.conf
grep -q '^DisableSandbox' /etc/pacman.conf || sed -i '/^\[options\]/a DisableSandbox' /etc/pacman.conf
pacman -Syu --noconfirm --disable-sandbox >/dev/null 2>&1
pacman -S --noconfirm --disable-sandbox --needed \
  xorg-server-xvfb imagemagick mesa gtk3 webkit2gtk-4.1 dbus ttf-dejavu fontconfig libayatana-appindicator >/dev/null 2>&1
echo "arch: $(pacman -Q webkit2gtk-4.1 mesa | tr '\n' ' ')"

export DISPLAY=:99 HOME=/tmp/home
mkdir -p "$HOME"
Xvfb :99 -screen 0 1280x900x24 >/dev/null 2>&1 &
sleep 2
eval "$(dbus-launch --sh-syntax)"
cd /tmp
env $APP_ENV /app/solstice.AppImage --appimage-extract-and-run >/out/app.log 2>&1 &

# A blank window is one flat color; the app has hundreds. Give it a minute.
colors=0
for _ in $(seq 1 30); do
  sleep 2
  import -window root /out/screenshot.png 2>/dev/null || continue
  colors=$(magick /out/screenshot.png -format %k info:)
  [ "$colors" -gt 50 ] && break
done

echo "colors on screen: $colors"
if grep -q "Could not create default EGL display" /out/app.log; then
  echo "FAIL: WebKit could not create an EGL display (see app.log)"; exit 1
fi
if [ "$colors" -le 50 ]; then
  echo "FAIL: the window is blank (screenshot.png, app.log)"; tail -20 /out/app.log; exit 1
fi
echo "OK: the app drew its window"
EOF
