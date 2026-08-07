// CommandMeta.default_accelerator comes back in Tauri's menu format
// ("CmdOrCtrl+Shift+B"). Each consumer wants a different shape.

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

/** "CmdOrCtrl+Shift+B" -> "$mod+Shift+b" */
export function toTinykeysFormat(accelerator: string): string {
  const parts = accelerator.replace(/CmdOrCtrl/gi, "$mod").split("+");
  const key = normalizeBaseKey(parts.pop()!);
  return [...parts, key].join("+");
}

/** "CmdOrCtrl+Shift+B" -> "Mod-Shift-b" (prosemirror-keymap style) */
export function toProseMirrorFormat(accelerator: string): string {
  const parts = accelerator.replace(/CmdOrCtrl/gi, "Mod").split("+");
  const key = normalizeBaseKey(parts.pop()!);
  return [...parts, key].join("-");
}