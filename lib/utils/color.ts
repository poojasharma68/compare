/** CSS + Figma color parsing and perceptual distance. */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  transparent: 'rgba(0,0,0,0)',
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  navy: '#000080',
  teal: '#008080',
  olive: '#808000',
  purple: '#800080',
  maroon: '#800000',
  lime: '#00ff00',
  aqua: '#00ffff',
  cyan: '#00ffff',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  yellow: '#ffff00',
  orange: '#ffa500',
};

export function parseColor(input: string | undefined | null): Rgba | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  if (value === 'none' || value === 'currentcolor' || value === 'inherit') return null;
  if (NAMED[value]) value = NAMED[value];

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const parts = hex.split('').map((c) => parseInt(c + c, 16));
      return { r: parts[0], g: parts[1], b: parts[2], a: hex.length === 4 ? parts[3] / 255 : 1 };
    }
    if (hex.length === 6 || hex.length === 8) {
      const num = (i: number) => parseInt(hex.slice(i, i + 2), 16);
      return { r: num(0), g: num(2), b: num(4), a: hex.length === 8 ? num(6) / 255 : 1 };
    }
    return null;
  }

  const fn = value.match(/^(rgba?|hsla?)\(([^)]+)\)$/);
  if (!fn) return null;
  const parts = fn[2]
    .replace(/\//g, ' ')
    .split(/[,\s]+/)
    .filter(Boolean);
  if (parts.length < 3) return null;

  const toAlpha = (raw: string | undefined): number => {
    if (raw === undefined) return 1;
    if (raw.endsWith('%')) return clamp01(parseFloat(raw) / 100);
    const n = parseFloat(raw);
    return Number.isFinite(n) ? clamp01(n) : 1;
  };

  if (fn[1].startsWith('hsl')) {
    const h = ((parseFloat(parts[0]) % 360) + 360) % 360;
    const s = clamp01(parseFloat(parts[1]) / 100);
    const l = clamp01(parseFloat(parts[2]) / 100);
    const { r, g, b } = hslToRgb(h, s, l);
    return { r, g, b, a: toAlpha(parts[3]) };
  }

  const channel = (raw: string) =>
    raw.endsWith('%')
      ? Math.round(clamp01(parseFloat(raw) / 100) * 255)
      : Math.round(Math.min(255, Math.max(0, parseFloat(raw))));
  return {
    r: channel(parts[0]),
    g: channel(parts[1]),
    b: channel(parts[2]),
    a: toAlpha(parts[3]),
  };
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(h / 60) % 6;
  const table: Array<[number, number, number]> = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = table[seg];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function figmaColorToRgba(color: { r: number; g: number; b: number; a?: number }, opacity = 1): Rgba {
  return {
    r: Math.round(color.r * 255),
    g: Math.round(color.g * 255),
    b: Math.round(color.b * 255),
    a: clamp01((color.a ?? 1) * opacity),
  };
}

export function formatRgba(c: Rgba): string {
  if (c.a >= 0.999) {
    return `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  }
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Number(c.a.toFixed(3))})`;
}

export function isTransparent(c: Rgba | null): boolean {
  return !c || c.a < 0.02;
}

/** sRGB → CIE Lab, needed for a perceptual (not channel-wise) distance. */
function rgbToLab({ r, g, b }: Rgba): [number, number, number] {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * CIE76 deltaE between two colors, composited onto `backdrop` first so that
 * semi-transparent CSS colors compare fairly against flat Figma fills.
 */
export function colorDistance(a: Rgba, b: Rgba, backdrop: Rgba = { r: 255, g: 255, b: 255, a: 1 }): number {
  const ca = composite(a, backdrop);
  const cb = composite(b, backdrop);
  const [l1, a1, b1] = rgbToLab(ca);
  const [l2, a2, b2] = rgbToLab(cb);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

export function composite(fg: Rgba, bg: Rgba): Rgba {
  if (fg.a >= 0.999) return fg;
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}
