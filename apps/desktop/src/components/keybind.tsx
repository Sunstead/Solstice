import { platform } from '@/lib/backend/shell';
import { Kbd, KbdGroup } from '@sunstead/ui/components/kbd';
import { cn } from '@/lib/utils';

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

/**
 * Named keys as macOS writes them. Without this an accelerator like
 * `Alt+ArrowLeft` renders a chip reading "ArrowLeft", which is both wrong for
 * the platform and wide enough to unbalance a list of shortcuts.
 */
const MAC_KEY_SYMBOLS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Enter: '↩',
  Backspace: '⌫',
  Delete: '⌦',
  Escape: '⎋',
  Tab: '⇥',
  Space: '␣',
  PageUp: '⇞',
  PageDown: '⇟',
  Home: '↖',
  End: '↘',
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
  if (!accelerator) return [];
  const map = isMac ? MAC_SYMBOLS : WIN_LABELS;
  const parts = accelerator.split('+');
  const key = parts.pop()!;
  // The trailing part goes through the map too, so a partial accelerator of
  // only held modifiers still renders as symbols while a keybind is recorded.
  const displayKey = isMac
    ? MAC_KEY_SYMBOLS[key] ?? normalizeBaseKey(key)
    : normalizeBaseKey(key);
  return [...parts.map((p) => map[p] ?? p), map[key] ?? displayKey];
}

interface KeybindProps {
  /** e.g. "CmdOrCtrl+Shift+B" */
  accelerator: string;
  /** `warning` marks an accelerator that more than one command answers to. */
  tone?: 'default' | 'warning';
  className?: string;
}

/**
 * Renders a Tauri/Electron-style accelerator as a shadcn KbdGroup.
 * Mac renders modifier symbols back-to-back (⌘⇧B); other platforms
 * render each key as its own Kbd joined by a literal "+" (Ctrl+Shift+B).
 */
export function Keybind({
  accelerator,
  tone = 'default',
  className,
}: KeybindProps) {
  const tokens = acceleratorToTokens(accelerator);

  return (
    <KbdGroup className={className}>
      {tokens.map((token, i) => (
        <Kbd
          key={`${token}-${i}`}
          className={cn(tone === 'warning' && 'bg-warning/15 text-warning')}
        >
          {token}
        </Kbd>
      ))}
    </KbdGroup>
  );
}