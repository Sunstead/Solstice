import { platform } from '@tauri-apps/plugin-os';
import { Kbd, KbdGroup } from '@/components/ui/kbd';

/**
 * Tauri accelerators write single-character keys in uppercase
 * ("CmdOrCtrl+B"). For *display* we want the opposite of the tinykeys/
 * prosemirror normalization: show the key as it'd appear printed on a
 * keyboard, i.e. uppercase.
 */
function normalizeBaseKey(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
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
  Cmd: '⌘',
  Shift: '⇧',
  Alt: '⌥',
  Option: '⌥',
  Ctrl: '⌃',
};

const WIN_LABELS: Record<string, string> = {
  CmdOrCtrl: 'Ctrl',
  Cmd: 'Ctrl',
  Shift: 'Shift',
  Alt: 'Alt',
  Option: 'Alt',
  Ctrl: 'Ctrl',
};

/**
 * Splits an accelerator ("CmdOrCtrl+Shift+B") into per-key display tokens,
 * translating modifiers to the platform-appropriate symbol (mac) or label
 * (Windows/Linux).
 */
function acceleratorToTokens(accelerator: string): string[] {
  const parts = accelerator.split('+');
  const key = parts.pop()!;
  const displayKey = normalizeBaseKey(key);
  const map = isMac ? MAC_SYMBOLS : WIN_LABELS;
  const modifiers = parts.map((p) => map[p] ?? p);
  return [...modifiers, displayKey];
}

interface KeybindProps {
  /** e.g. "CmdOrCtrl+Shift+B" */
  accelerator: string;
  className?: string;
}

/**
 * Renders a Tauri/Electron-style accelerator as a shadcn KbdGroup.
 * Mac renders modifier symbols back-to-back (⌘⇧B); other platforms
 * render each key as its own Kbd joined by a literal "+" (Ctrl+Shift+B).
 */
export function Keybind({ accelerator, className }: KeybindProps) {
  const tokens = acceleratorToTokens(accelerator);

  return (
    <KbdGroup className={className}>
      {tokens.map((token, i) => (
        <span key={`${token}-${i}`} className="inline-flex items-center gap-1">
          {/* {!isMac && i > 0 && <span className="text-muted-foreground">+</span>} */}
          <Kbd>{token}</Kbd>
        </span>
      ))}
    </KbdGroup>
  );
}