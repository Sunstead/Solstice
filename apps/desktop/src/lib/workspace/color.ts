/**
 * Workspace colors. A workspace with no color of its own gets one from its
 * name, so it's the same on every device and on the web without anything
 * being written; picking one stores it (`.solstice/workspace.json`, and the
 * vault's on the server).
 *
 * Generated colors are mid-tones from OKLCH, where equal steps look equal:
 * a narrow band of lightness and a high chroma, any hue, so none is washed out or
 * glaring and white letters read on most.
 */

/**
 * `#rgb` or `#rrggbb`, any case, as lowercase `#rrggbb`; null for anything
 * else. Mirrors `normalize_hex` in `crates/solstice-core/src/color.rs`.
 */
export function normalizeHex(input: string): string | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!match) return null;
  const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join('') : match[1];
  return `#${hex.toLowerCase()}`;
}

const LIGHTNESS = [0.52, 0.6] as const;
const CHROMA = [0.16, 0.21] as const;

/** The color a workspace has until one is picked: seeded by its name. */
export function defaultWorkspaceColor(name: string): string {
  return colorFrom(seeded(hash(name.trim().toLowerCase())));
}

/** Shuffle: any color from the same band. */
export function randomWorkspaceColor(random: () => number = Math.random): string {
  return colorFrom(random);
}

/** The picker's swatches: twelve hues, evenly round the wheel. */
export const WORKSPACE_SWATCHES: readonly string[] = Array.from({ length: 12 }, (_, i) =>
  oklchToHex(0.6, 0.2, 25 + i * 30),
);

const LIGHT_TEXT = '#ffffff';
const DARK_TEXT = '#171717';

/**
 * The letters' color: white wherever it reads (3:1, as for large text, which
 * a bold monogram is), else near-black. A custom pale color gets dark letters.
 */
export function textColorFor(background: string): string {
  return contrastRatio(background, LIGHT_TEXT) >= 3 ? LIGHT_TEXT : DARK_TEXT;
}

/** WCAG contrast between two `#rrggbb` colors, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function colorFrom(random: () => number): string {
  const hue = random() * 360;
  const lightness = LIGHTNESS[0] + random() * (LIGHTNESS[1] - LIGHTNESS[0]);
  const chroma = CHROMA[0] + random() * (CHROMA[1] - CHROMA[0]);
  return oklchToHex(lightness, chroma, hue);
}

/** OKLCH to sRGB hex, giving up chroma (never lightness or hue) to fit. */
function oklchToHex(l: number, c: number, h: number): string {
  let rgb = oklchToLinear(l, c, h);
  for (let chroma = c; !rgb.every((v) => v >= 0 && v <= 1) && chroma > 0; ) {
    chroma = Math.max(0, chroma - 0.005);
    rgb = oklchToLinear(l, chroma, h);
  }
  return `#${rgb
    .map((v) => Math.round(fromLinear(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

// Björn Ottosson's OKLab, to linear sRGB.
function oklchToLinear(l: number, c: number, h: number): number[] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

function toLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function fromLinear(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** FNV-1a: a name to 32 bits. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a seed to a stream of numbers in [0, 1). */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
