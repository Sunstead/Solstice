#!/usr/bin/env bash
# Takes the libwayland-* libraries out of a Tauri AppImage, and signs it again.
#
# linuxdeploy bundles the build machine's libwayland (Ubuntu 22.04's) because
# WebKitGTK links it. A current distribution's Mesa loads its own EGL against
# whatever libwayland-client the process already has, finds the old bundled
# one lacking, and WebKit's web process aborts with "Could not create default
# EGL display: EGL_BAD_PARAMETER": a blank gray window, on Arch and anything
# else recent. Wayland, like libEGL and libgbm, has to come from the running
# system, which every GTK3 install has. The .deb links the system's already.
#
# Usage: appimage-unbundle-wayland.sh <app.AppImage>...
# Re-signs (for the updater) when a .sig sits beside the file; needs
# TAURI_SIGNING_PRIVATE_KEY in the environment then.
set -euo pipefail

command -v mksquashfs >/dev/null || { echo "mksquashfs not found (apt install squashfs-tools)" >&2; exit 1; }

for appimage in "$@"; do
  appimage=$(realpath "$appimage")
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT

  # The runtime is everything before the squashfs; it reports where that starts
  # without mounting anything, so no FUSE is needed.
  offset=$("$appimage" --appimage-offset)
  comp=$(unsquashfs -s -o "$offset" "$appimage" | awk '/^Compression/ { print $2 }')
  head -c "$offset" "$appimage" > "$work/runtime"
  unsquashfs -q -o "$offset" -d "$work/root" "$appimage"

  removed=$(find "$work/root" \( -type f -o -type l \) -name 'libwayland-*.so*' -print -delete | wc -l)
  echo "$(basename "$appimage"): removed $removed libwayland files"
  if [ "$removed" -eq 0 ]; then
    echo "  nothing to remove (linuxdeploy no longer bundles them); leaving it as it is"
    rm -rf "$work"; trap - EXIT
    continue
  fi

  mksquashfs "$work/root" "$work/new.squashfs" -root-owned -noappend -quiet -comp "${comp:-gzip}"
  cat "$work/runtime" "$work/new.squashfs" > "$work/new.AppImage"
  chmod +x "$work/new.AppImage"
  mv "$work/new.AppImage" "$appimage"

  # The bytes changed, so the updater's signature of the old ones no longer holds.
  if [ -f "$appimage.sig" ]; then
    : "${TAURI_SIGNING_PRIVATE_KEY:?needed to sign the repacked AppImage again}"
    rm -f "$appimage.sig"
    npm run --silent tauri -- signer sign "$appimage"
    [ -s "$appimage.sig" ] || { echo "signing produced no $appimage.sig" >&2; exit 1; }
  fi
  rm -rf "$work"; trap - EXIT
done
