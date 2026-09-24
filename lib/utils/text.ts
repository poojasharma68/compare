/** Text normalization + similarity used by the element matcher. */

export function normalizeText(input: string | undefined | null): string {
  if (!input) return '';
  return input
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .trim()
    .toLowerCase();
}

/** Strips punctuation too — for comparing copy that differs only in styling. */
export function canonicalText(input: string | undefined | null): string {
  return normalizeText(input)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(input: string): string[] {
  const canon = canonicalText(input);
  return canon ? canon.split(' ') : [];
}

/** Levenshtein with an early-exit band; O(n·m) but inputs are short strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > 200) return Math.max(a.length, b.length);

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length];
}

/** 0–1 edit-distance similarity over canonical text. */
export function editSimilarity(a: string, b: string): number {
  const x = canonicalText(a);
  const y = canonicalText(b);
  if (!x && !y) return 0;
  if (!x || !y) return 0;
  if (x === y) return 1;
  const max = Math.max(x.length, y.length);
  // Cheap guard: wildly different lengths are never a text match.
  if (Math.min(x.length, y.length) / max < 0.3) return 0;
  return 1 - levenshtein(x, y) / max;
}

/** 0–1 token overlap (Dice coefficient) — robust to reordered/extra words. */
export function tokenSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.length || !tb.length) return 0;
  const setB = new Map<string, number>();
  for (const t of tb) setB.set(t, (setB.get(t) ?? 0) + 1);
  let shared = 0;
  for (const t of ta) {
    const n = setB.get(t) ?? 0;
    if (n > 0) {
      shared++;
      setB.set(t, n - 1);
    }
  }
  return (2 * shared) / (ta.length + tb.length);
}

/** Combined text score: exact > edit distance > token overlap > containment. */
export function textSimilarity(a: string, b: string): number {
  const x = canonicalText(a);
  const y = canonicalText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const edit = editSimilarity(x, y);
  const token = tokenSimilarity(x, y);
  // A short Figma label fully contained in a longer DOM string is still a
  // strong signal (e.g. a button label inside a wrapper's textContent).
  let containment = 0;
  if (x.length >= 3 && y.length >= 3) {
    if (y.includes(x)) containment = x.length / y.length;
    else if (x.includes(y)) containment = y.length / x.length;
  }
  return Math.max(edit, token, containment * 0.9);
}

/** Normalizes a font stack down to its first family for comparison. */
export function primaryFontFamily(stack: string | undefined | null): string {
  if (!stack) return '';
  const first = stack.split(',')[0] ?? '';
  return first
    .replace(/["']/g, '')
    .trim()
    .toLowerCase();
}

/** True when two font stacks name the same family, ignoring weight suffixes. */
export function fontFamilyMatches(a: string | undefined, b: string | undefined): boolean {
  const fa = primaryFontFamily(a);
  const fb = primaryFontFamily(b);
  if (!fa || !fb) return true; // Unknown on either side — do not flag.
  if (fa === fb) return true;
  const strip = (s: string) =>
    s.replace(/\s*(thin|extralight|ultralight|light|regular|medium|semibold|demibold|bold|extrabold|black|heavy|italic|oblique|display|text)\s*$/g, '').replace(/[\s-]/g, '');
  return strip(fa) === strip(fb);
}

export function truncate(input: string, max = 90): string {
  const s = input.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
