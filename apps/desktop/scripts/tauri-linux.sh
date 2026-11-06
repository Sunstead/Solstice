#!/usr/bin/env bash
# `tauri` for Linux release builds: the same command, then the AppImage fixed
# up (appimage-unbundle-wayland.sh). tauri-action runs it as its `tauriScript`
# and reads the bundles afterwards, so what it uploads, and the signatures in
# latest.json, are the fixed ones.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run --silent tauri -- "$@"

# Bundles are only built by `tauri build`.
if [ "${1:-}" = build ]; then
  shopt -s nullglob
  appimages=(../../target/release/bundle/appimage/*.AppImage)
  if [ ${#appimages[@]} -gt 0 ]; then
    ./scripts/appimage-unbundle-wayland.sh "${appimages[@]}"
  fi
fi
