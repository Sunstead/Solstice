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

/**
 * Punctuation and digit `KeyboardEvent.code` names, mapped to the short form
 * the command registry writes (`Comma` -> `,`). muda accepts either spelling,
 * but the short form is what `Keybind` renders as a legible chip.
 */
const CODE_SYMBOLS: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Minus: '-',
  Equal: '=',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`',
};

function codeToKey(code: string): string {
  if (CODE_SYMBOLS[code]) return CODE_SYMBOLS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  return code;
}

/** The parts of a keyboard event an accelerator is built from. */
export interface KeyStroke {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * The modifiers currently held, in the order accelerators are written.
 *
 * `CmdOrCtrl` is Cmd on macOS and Ctrl elsewhere, so a real Ctrl press is only
 * its own token on macOS, where the two keys are distinct.
 */
export function modifiersOf(event: KeyStroke): string[] {
  const modifiers: string[] = [];
  if (isMac ? event.metaKey : event.ctrlKey) modifiers.push('CmdOrCtrl');
  if (isMac && event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  return modifiers;
}

/**
 * A keydown as a Tauri accelerator, or null while only modifiers are held.
 *
 * Reads `event.code` rather than `event.key`: with Alt held macOS reports the
 * alternate character (⌥N is "˜"), and with Shift held the shifted symbol,
 * neither of which round-trips back to a binding.
 */
export function eventToAccelerator(event: KeyStroke): string | null {
  const { code } = event;
  if (!code || /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/.test(code)) {
    return null;
  }
  return [...modifiersOf(event), codeToKey(code)].join('+');
}
