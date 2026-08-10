import { platform } from '@tauri-apps/plugin-os';

/**
 * Tauri accelerators write single-character keys in uppercase
 * ("CmdOrCtrl+B"). Both tinykeys and prosemirror-keymap parse an uppercase
 * single letter as implicitly requiring Shift -- a real Ctrl+B keydown
 * reports event.key === "b" (lowercase), so an un-normalized "B" binding
 * would silently register as Ctrl+Shift+B and never match a plain Ctrl+B
 * press. Named keys ("Enter", "ArrowUp", "F5", ...) are left untouched;
 * only single-character keys get lowercased.
 */
function normalizeBaseKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function convert(
  accelerator: string,
  modToken: string,
  separator: string,
): string {
  const parts = accelerator.replace(/CmdOrCtrl/gi, modToken).split('+');
  const key = normalizeBaseKey(parts.pop()!);
  return [...parts, key].join(separator);
}

/** "CmdOrCtrl+Shift+B" -> "$mod+Shift+b" */
export function toTinykeysFormat(accelerator: string): string {
  return convert(accelerator, '$mod', '+');
}

/** "CmdOrCtrl+Shift+B" -> "Mod-Shift-b" (prosemirror-keymap style) */
export function toProseMirrorFormat(accelerator: string): string {
  return convert(accelerator, 'Mod', '-');
}

const isMac = (() => {
  try {
    return platform() === 'macos';
  } catch {
    return false;
  }
})();

const MAC_SYMBOLS: Record<string, string> = {
  CmdOrCtrl: '⌘',
  Shift: '⇧',
  Alt: '⌥',
  Ctrl: '⌃',
};
const WIN_LABELS: Record<string, string> = {
  CmdOrCtrl: 'Ctrl',
  Shift: 'Shift',
  Alt: 'Alt',
  Ctrl: 'Ctrl',
};

/** "CmdOrCtrl+Shift+B" -> "⌘⇧B" (mac) or "Ctrl+Shift+B" (other) */
export function toDisplayFormat(accelerator: string): string {
  const parts = accelerator.split('+');
  const key = parts.pop()!;
  const displayKey = key.length === 1 ? key.toUpperCase() : key;
  if (isMac) {
    return [...parts.map((p) => MAC_SYMBOLS[p] ?? p), displayKey].join('');
  }
  return [...parts.map((p) => WIN_LABELS[p] ?? p), displayKey].join('+');
}
