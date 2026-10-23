/**
 * The ink tools the ribbon and the squeeze palette show (iOS, `can.nativeViews`):
 * a row of slots, each a tool with its own color, width and opacity, as
 * Notes keeps them. Pure, so the store, the ribbon and the Pencil's gestures
 * share it; Swift only applies the slot in hand (`toNative`, `ToolSpec.swift`).
 */

export const INK_KINDS = [
  'pen',
  'monoline',
  'fountainPen',
  'marker',
  'pencil',
  'crayon',
  'watercolor',
  'reed',
] as const;
export type InkKind = (typeof INK_KINDS)[number];
export type ToolKind = InkKind | 'eraser' | 'lasso';
export const TOOL_KINDS: readonly ToolKind[] = [...INK_KINDS, 'eraser', 'lasso'];
export type EraserMode = 'vector' | 'bitmap';

export const TOOL_LABELS: Record<ToolKind, string> = {
  pen: 'Pen',
  monoline: 'Monoline',
  fountainPen: 'Fountain Pen',
  marker: 'Highlighter',
  pencil: 'Pencil',
  crayon: 'Crayon',
  watercolor: 'Watercolor',
  reed: 'Reed Pen',
  eraser: 'Eraser',
  lasso: 'Lasso',
};

export type ToolSlot = {
  id: string;
  kind: ToolKind;
  /** `#rrggbb`, lowercase. */
  color: string;
  width: number;
  opacity: number;
  /** Erasers only: whole strokes, or the pixels under it. */
  eraser?: EraserMode;
};

export type Toolbox = {
  slots: ToolSlot[];
  selected: string;
  /** The slot in hand before this one: double tap's Previous Tool. */
  previous: string | null;
  /** Slot ids, most recent first: the squeeze palette's ring. */
  recents: string[];
  /** Colors picked that aren't in the palette, most recent first. */
  recentColors: string[];
  ruler: boolean;
  /** A finger draws too, on every surface. */
  fingerDraws: boolean;
};

export const MAX_RECENT_TOOLS = 6;
export const MAX_RECENT_COLORS = 8;

/** Ink colors, saved into files as drawn: they don't follow the theme. */
export const INK_PALETTE = [
  '#000000',
  '#8e8e93',
  '#ffffff',
  '#0a84ff',
  '#ff3b30',
  '#ff9500',
  '#ffcc00',
  '#34c759',
  '#af52de',
] as const;

/** Six widths per tool, thin to thick: Apple's picker's five and one finer. */
const WIDTHS: Record<ToolKind, readonly number[]> = {
  pen: [0.8, 1.5, 3, 5, 8, 12],
  monoline: [0.6, 1, 2, 4, 6, 9],
  fountainPen: [1, 2, 4, 6, 9, 13],
  marker: [4, 8, 14, 20, 26, 32],
  pencil: [0.8, 1.5, 2.5, 4, 6, 9],
  crayon: [3, 6, 10, 14, 20, 26],
  watercolor: [4, 8, 14, 20, 28, 36],
  reed: [1.5, 3, 6, 9, 13, 18],
  eraser: [3, 6, 12, 20, 30, 45],
  lasso: [1],
};

/** Where a tool starts: the middle of its widths. */
const DEFAULT_WIDTH = 3;

export function presetWidths(kind: ToolKind): readonly number[] {
  return WIDTHS[kind];
}

export const hasInk = (kind: ToolKind): kind is InkKind => (INK_KINDS as readonly string[]).includes(kind);

const HEX = /^#[0-9a-f]{6}$/i;
const isHex = (value: unknown): value is string => typeof value === 'string' && HEX.test(value);
const clampOpacity = (value: number) => Math.min(1, Math.max(0.1, value));

function snapWidth(kind: ToolKind, width: number): number {
  const presets = WIDTHS[kind];
  return presets.reduce((best, w) => (Math.abs(w - width) < Math.abs(best - width) ? w : best), presets[0]);
}

function slotOf(id: string, kind: ToolKind, color = '#000000'): ToolSlot {
  const slot: ToolSlot = {
    id,
    kind,
    color,
    width: WIDTHS[kind][Math.min(DEFAULT_WIDTH, WIDTHS[kind].length - 1)],
    opacity: 1,
  };
  if (kind === 'eraser') slot.eraser = 'vector';
  return slot;
}

export function defaultToolbox(): Toolbox {
  const slots = [
    slotOf('pen', 'pen'),
    slotOf('monoline', 'monoline', '#0a84ff'),
    slotOf('fountainPen', 'fountainPen'),
    slotOf('marker', 'marker', '#ffcc00'),
    slotOf('pencil', 'pencil', '#8e8e93'),
    slotOf('crayon', 'crayon', '#ff3b30'),
    slotOf('watercolor', 'watercolor', '#34c759'),
    slotOf('eraser', 'eraser'),
    slotOf('lasso', 'lasso'),
  ];
  return {
    slots,
    selected: 'pen',
    previous: null,
    recents: ['pen'],
    recentColors: [],
    ruler: false,
    fingerDraws: false,
  };
}

export const selectedSlot = (state: Toolbox): ToolSlot =>
  state.slots.find((s) => s.id === state.selected) ?? state.slots[0];

export type ToolboxAction =
  | { type: 'select'; id: string }
  | { type: 'selectPrevious' }
  | { type: 'toggleEraser' }
  /** `recent: false` while Apple's picker is still being dragged: only where it settles is kept. */
  | { type: 'setColor'; color: string; recent?: boolean }
  | { type: 'setWidth'; width: number }
  | { type: 'setOpacity'; opacity: number }
  | { type: 'setEraserMode'; mode: EraserMode }
  | { type: 'add'; newId: string }
  | { type: 'duplicate'; id: string; newId: string }
  | { type: 'remove'; id: string }
  | { type: 'changeKind'; id: string; kind: ToolKind }
  | { type: 'move'; from: number; to: number }
  | { type: 'toggleRuler' }
  | { type: 'setFingerDraws'; on: boolean };

function select<T extends Toolbox>(state: T, id: string): T {
  if (id === state.selected || !state.slots.some((s) => s.id === id)) return state;
  const recents = [id, ...state.recents.filter((r) => r !== id)].slice(0, MAX_RECENT_TOOLS);
  return { ...state, selected: id, previous: state.selected, recents };
}

function updateSelected<T extends Toolbox>(state: T, change: (slot: ToolSlot) => ToolSlot | null): T {
  const slot = selectedSlot(state);
  const next = change(slot);
  if (!next) return state;
  return { ...state, slots: state.slots.map((s) => (s.id === slot.id ? next : s)) };
}

/** Returns `state` itself when nothing changes. Generic so a store's own fields ride along. */
export function toolbox<T extends Toolbox>(state: T, action: ToolboxAction): T {
  switch (action.type) {
    case 'select':
      return select(state, action.id);
    case 'selectPrevious':
      return state.previous ? select(state, state.previous) : state;
    case 'toggleEraser': {
      if (selectedSlot(state).kind === 'eraser') return state.previous ? select(state, state.previous) : state;
      const eraser = state.slots.find((s) => s.kind === 'eraser');
      return eraser ? select(state, eraser.id) : state;
    }
    case 'setColor': {
      if (!isHex(action.color)) return state;
      const color = action.color.toLowerCase();
      const next = updateSelected(state, (slot) => (hasInk(slot.kind) ? { ...slot, color } : null));
      if (next === state || action.recent === false || (INK_PALETTE as readonly string[]).includes(color)) return next;
      const recentColors = [color, ...state.recentColors.filter((c) => c !== color)].slice(0, MAX_RECENT_COLORS);
      return { ...next, recentColors };
    }
    case 'setWidth':
      return updateSelected(state, (slot) => ({ ...slot, width: snapWidth(slot.kind, action.width) }));
    case 'setOpacity':
      return updateSelected(state, (slot) => ({ ...slot, opacity: clampOpacity(action.opacity) }));
    case 'setEraserMode':
      return updateSelected(state, (slot) => (slot.kind === 'eraser' ? { ...slot, eraser: action.mode } : null));
    case 'add':
      return select({ ...state, slots: [...state.slots, slotOf(action.newId, 'pen')] }, action.newId);
    case 'duplicate': {
      const at = state.slots.findIndex((s) => s.id === action.id);
      if (at < 0) return state;
      const slots = [...state.slots];
      slots.splice(at + 1, 0, { ...state.slots[at], id: action.newId });
      return select({ ...state, slots }, action.newId);
    }
    case 'remove': {
      const at = state.slots.findIndex((s) => s.id === action.id);
      if (at < 0 || state.slots.length === 1) return state;
      const slots = state.slots.filter((s) => s.id !== action.id);
      const selected = state.selected === action.id ? slots[Math.min(at, slots.length - 1)].id : state.selected;
      const previous = state.previous === action.id || state.previous === selected ? null : state.previous;
      const recents = state.recents.filter((r) => r !== action.id);
      return { ...state, slots, selected, previous, recents };
    }
    case 'changeKind': {
      const slots = state.slots.map((s) => {
        if (s.id !== action.id || s.kind === action.kind) return s;
        return slotOf(s.id, action.kind, s.color);
      });
      return { ...state, slots };
    }
    case 'move': {
      const { from, to } = action;
      const count = state.slots.length;
      if (from === to || from < 0 || to < 0 || from >= count || to >= count) return state;
      const slots = [...state.slots];
      const [moved] = slots.splice(from, 1);
      slots.splice(to, 0, moved);
      return { ...state, slots };
    }
    case 'toggleRuler':
      return { ...state, ruler: !state.ruler };
    case 'setFingerDraws':
      return action.on === state.fingerDraws ? state : { ...state, fingerDraws: action.on };
  }
}

/** What's on disk, made safe: a hand edit or an older shape never breaks the tools. */
export function sanitize(raw: unknown): Toolbox {
  if (!raw || typeof raw !== 'object') return defaultToolbox();
  const input = raw as Record<string, unknown>;
  const slots: ToolSlot[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(input.slots) ? input.slots : []) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    if (typeof s.id !== 'string' || seen.has(s.id)) continue;
    if (!TOOL_KINDS.includes(s.kind as ToolKind)) continue;
    seen.add(s.id);
    const kind = s.kind as ToolKind;
    const slot = slotOf(s.id, kind, isHex(s.color) ? s.color.toLowerCase() : '#000000');
    if (typeof s.width === 'number' && Number.isFinite(s.width)) slot.width = snapWidth(kind, s.width);
    if (typeof s.opacity === 'number' && Number.isFinite(s.opacity)) slot.opacity = clampOpacity(s.opacity);
    if (kind === 'eraser' && (s.eraser === 'vector' || s.eraser === 'bitmap')) slot.eraser = s.eraser;
    slots.push(slot);
  }
  if (slots.length === 0) return defaultToolbox();

  const has = (id: unknown): id is string => typeof id === 'string' && seen.has(id);
  const selected = has(input.selected) ? input.selected : slots[0].id;
  const previous = has(input.previous) && input.previous !== selected ? input.previous : null;
  const recents = [...new Set((Array.isArray(input.recents) ? input.recents : []).filter(has))].slice(
    0,
    MAX_RECENT_TOOLS,
  );
  const recentColors = [
    ...new Set((Array.isArray(input.recentColors) ? input.recentColors : []).filter(isHex).map((c) => c.toLowerCase())),
  ].slice(0, MAX_RECENT_COLORS);
  return {
    slots,
    selected,
    previous,
    recents,
    recentColors,
    ruler: input.ruler === true,
    fingerDraws: input.fingerDraws === true,
  };
}

/** The slot as Swift's `ToolSpec` reads it. */
export function toNative(slot: ToolSlot) {
  return {
    kind: slot.kind,
    color: slot.color,
    width: slot.width,
    opacity: slot.opacity,
    eraser: slot.eraser ?? 'vector',
  };
}

/** `UIPencilPreferredAction`, as the native side names it. */
export type PencilPreference =
  | 'ignore'
  | 'switchEraser'
  | 'switchPrevious'
  | 'showColorPalette'
  | 'showInkAttributes'
  | 'showContextualPalette'
  | 'runSystemShortcut';

export type PencilGesture =
  | { gesture: 'tap'; preference: PencilPreference }
  | { gesture: 'squeeze'; phase: 'began' | 'changed' | 'ended' | 'cancelled'; preference: PencilPreference };

/** What the squeeze palette has fanned out: nothing more than its arc, colors, widths, or the rest of the tools. */
export type PalettePage = 'tools' | 'colors' | 'width' | 'more';
export type PencilResult =
  { type: 'toggleEraser' } | { type: 'selectPrevious' } | { type: 'palette'; page: PalettePage } | { type: 'none' };

/** What a double tap or squeeze does, as Settings says; a squeeze acts once it's let go. */
export function pencilAction(event: PencilGesture): PencilResult {
  if (event.gesture === 'squeeze' && event.phase !== 'ended') return { type: 'none' };
  switch (event.preference) {
    case 'switchEraser':
      return { type: 'toggleEraser' };
    case 'switchPrevious':
      return { type: 'selectPrevious' };
    case 'showColorPalette':
      return { type: 'palette', page: 'colors' };
    case 'showInkAttributes':
      return { type: 'palette', page: 'width' };
    case 'showContextualPalette':
      return { type: 'palette', page: 'tools' };
    default:
      // The system runs its own shortcut.
      return { type: 'none' };
  }
}
