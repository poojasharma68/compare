/**
 * Every threshold the comparison engines use. Values are in CSS pixels unless
 * noted. Overridable per-run via `resolveTolerances()` so thresholds stay
 * configurable without touching engine code.
 */
export interface Tolerances {
  /** Layout */
  POSITION_TOLERANCE: number;
  SIZE_TOLERANCE: number;
  /** Fraction of element size allowed on top of the absolute tolerance. */
  SIZE_RELATIVE_TOLERANCE: number;
  ALIGNMENT_TOLERANCE: number;

  /** Spacing */
  PADDING_TOLERANCE: number;
  GAP_TOLERANCE: number;

  /** Typography */
  FONT_SIZE_TOLERANCE: number;
  FONT_WEIGHT_TOLERANCE: number;
  LINE_HEIGHT_TOLERANCE: number;
  LETTER_SPACING_TOLERANCE: number;

  /** Color — CIE76-ish deltaE over sRGB; ~2.3 is the "just noticeable" mark. */
  COLOR_TOLERANCE: number;
  /** Alpha channel absolute difference. */
  ALPHA_TOLERANCE: number;

  /** Styling */
  RADIUS_TOLERANCE: number;
  BORDER_WIDTH_TOLERANCE: number;
  OPACITY_TOLERANCE: number;

  /** Matching */
  MATCH_THRESHOLD: number;
  /** Below this, a matched pair is reported but not used for strict checks. */
  STRICT_MATCH_THRESHOLD: number;
  /** Figma nodes below this significance are not required to exist in the DOM. */
  MIN_FIGMA_SIGNIFICANCE: number;
  MIN_DOM_SIGNIFICANCE: number;

  /** Severity escalation: multiples of the tolerance. */
  MINOR_MULTIPLIER: number;
  MAJOR_MULTIPLIER: number;

  /** Responsive */
  OVERFLOW_TOLERANCE: number;
  OVERLAP_AREA_RATIO: number;
  OVERLAP_MIN_AREA: number;
  CLIPPING_TOLERANCE: number;
  EXCESSIVE_WHITESPACE: number;
  IMAGE_DISTORTION_RATIO: number;
}

export const DEFAULT_TOLERANCES: Tolerances = {
  POSITION_TOLERANCE: 4,
  SIZE_TOLERANCE: 4,
  SIZE_RELATIVE_TOLERANCE: 0.02,
  ALIGNMENT_TOLERANCE: 4,

  PADDING_TOLERANCE: 4,
  GAP_TOLERANCE: 4,

  FONT_SIZE_TOLERANCE: 1,
  FONT_WEIGHT_TOLERANCE: 25,
  LINE_HEIGHT_TOLERANCE: 2,
  LETTER_SPACING_TOLERANCE: 0.5,

  COLOR_TOLERANCE: 6,
  ALPHA_TOLERANCE: 0.05,

  RADIUS_TOLERANCE: 1,
  BORDER_WIDTH_TOLERANCE: 1,
  OPACITY_TOLERANCE: 0.05,

  MATCH_THRESHOLD: 0.55,
  STRICT_MATCH_THRESHOLD: 0.72,
  MIN_FIGMA_SIGNIFICANCE: 0.45,
  MIN_DOM_SIGNIFICANCE: 0.5,

  MINOR_MULTIPLIER: 2,
  MAJOR_MULTIPLIER: 4,

  OVERFLOW_TOLERANCE: 2,
  OVERLAP_AREA_RATIO: 0.22,
  OVERLAP_MIN_AREA: 900,
  CLIPPING_TOLERANCE: 2,
  EXCESSIVE_WHITESPACE: 480,
  IMAGE_DISTORTION_RATIO: 0.2,
};

/**
 * Figma px and CSS px are the same unit, so when the design frame and the
 * reference viewport are close in width we compare absolutely and stay exact.
 * Scaling is only introduced once the two genuinely differ, because scaling
 * multiplies every coordinate and would manufacture failures that are really
 * just an artefact of the viewport we happened to pick.
 */
export const NATIVE_SCALE_BAND = 0.2;

export function resolveScale(viewportWidth: number, designWidth: number): number {
  if (designWidth <= 0) return 1;
  const ratio = viewportWidth / designWidth;
  return Math.abs(ratio - 1) <= NATIVE_SCALE_BAND ? 1 : ratio;
}

export function resolveTolerances(overrides?: Partial<Tolerances>): Tolerances {
  if (!overrides) return { ...DEFAULT_TOLERANCES };
  const merged = { ...DEFAULT_TOLERANCES };
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === 'number' && Number.isFinite(value) && key in merged) {
      (merged as unknown as Record<string, number>)[key] = value;
    }
  }
  return merged;
}

/**
 * Classifies a numeric deviation against a tolerance band.
 * `PASS` inside tolerance, then minor / major / critical as the miss grows.
 */
export function classifyDeviation(
  delta: number,
  tolerance: number,
  t: Tolerances,
): { status: 'PASS' | 'WARNING' | 'FAIL'; severity: 'none' | 'minor' | 'major' | 'critical' } {
  const abs = Math.abs(delta);
  if (abs <= tolerance) return { status: 'PASS', severity: 'none' };
  if (abs <= tolerance * t.MINOR_MULTIPLIER) return { status: 'WARNING', severity: 'minor' };
  if (abs <= tolerance * t.MAJOR_MULTIPLIER) return { status: 'FAIL', severity: 'major' };
  return { status: 'FAIL', severity: 'critical' };
}
