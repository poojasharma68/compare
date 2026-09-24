import type { UiTestResult } from '@/lib/types/tests';
import { fontFamilyMatches, primaryFontFamily } from '@/lib/utils/text';
import { buildTest, numericTest, type ComparisonContext, type MatchedPair } from './context';

/**
 * Typography checks for TEXT layers.
 *
 * Type sizes are compared *unscaled*: Figma px and CSS px are the same unit and
 * designers specify type absolutely, so scaling font sizes by the layout scale
 * factor would invent failures on any viewport narrower than the design frame.
 * When the reference viewport is far from the design width the checks relax and
 * cap their severity instead.
 */
export function compareTypography(pair: MatchedPair, ctx: ComparisonContext): UiTestResult[] {
  const { node, el } = pair;
  const typography = node.typography;
  if (node.type !== 'TEXT' || !typography) return [];

  const t = ctx.tolerances;
  const relax = ctx.nearNativeScale ? 1 : 1.6;
  const maxSeverity = ctx.nearNativeScale ? undefined : ('major' as const);
  const scaleNote = ctx.nearNativeScale
    ? undefined
    : `Tolerance relaxed: the reference viewport is ${Math.round(ctx.scale * 100)}% of the design frame width.`;

  const tests: UiTestResult[] = [];

  if (typography.fontFamily) {
    const matches = fontFamilyMatches(typography.fontFamily, el.styles.fontFamily);
    tests.push(
      buildTest(ctx, {
        category: 'Typography',
        check: 'typography.fontFamily',
        title: 'Font family',
        pair,
        expected: typography.fontFamily,
        actual: primaryFontFamily(el.styles.fontFamily) || el.styles.fontFamily || 'unknown',
        difference: matches ? 'exact' : `${typography.fontFamily} → ${primaryFontFamily(el.styles.fontFamily)}`,
        status: matches ? 'PASS' : 'FAIL',
        severity: matches ? 'none' : 'major',
        message: matches
          ? undefined
          : 'The rendered family differs from the design. A missing @font-face or a fallback kicking in will cause this.',
      }),
    );
  }

  if (typeof typography.fontSize === 'number' && el.styles.fontSize > 0) {
    tests.push(
      numericTest(ctx, {
        category: 'Typography',
        check: 'typography.fontSize',
        title: 'Font size',
        pair,
        expected: typography.fontSize,
        actual: el.styles.fontSize,
        tolerance: t.FONT_SIZE_TOLERANCE * relax,
        maxSeverity,
        note: scaleNote,
      }),
    );
  }

  if (typeof typography.fontWeight === 'number' && el.styles.fontWeight > 0) {
    tests.push(
      numericTest(ctx, {
        category: 'Typography',
        check: 'typography.fontWeight',
        title: 'Font weight',
        pair,
        expected: typography.fontWeight,
        actual: el.styles.fontWeight,
        tolerance: t.FONT_WEIGHT_TOLERANCE,
        unit: '',
        decimals: 0,
      }),
    );
  }

  if (typeof typography.lineHeight === 'number' && typography.lineHeight > 0) {
    // `line-height: normal` resolves per font; treat it as unmeasurable rather
    // than guessing a number and reporting a false failure.
    if (el.styles.lineHeight === null) {
      tests.push(
        buildTest(ctx, {
          category: 'Typography',
          check: 'typography.lineHeight',
          title: 'Line height',
          pair,
          expected: `${typography.lineHeight.toFixed(1)}px`,
          actual: 'normal',
          difference: 'not comparable',
          status: 'WARNING',
          severity: 'minor',
          message:
            'The page leaves line-height at `normal`, so the design value cannot be verified. Set an explicit line-height.',
        }),
      );
    } else {
      tests.push(
        numericTest(ctx, {
          category: 'Typography',
          check: 'typography.lineHeight',
          title: 'Line height',
          pair,
          expected: typography.lineHeight,
          actual: el.styles.lineHeight,
          tolerance: t.LINE_HEIGHT_TOLERANCE * relax,
          maxSeverity,
          note: scaleNote,
        }),
      );
    }
  }

  if (typeof typography.letterSpacing === 'number') {
    tests.push(
      numericTest(ctx, {
        category: 'Typography',
        check: 'typography.letterSpacing',
        title: 'Letter spacing',
        pair,
        expected: typography.letterSpacing,
        actual: el.styles.letterSpacing,
        tolerance: t.LETTER_SPACING_TOLERANCE,
        decimals: 2,
      }),
    );
  }

  if (typography.textAlign) {
    const actual = normalizeAlign(el.styles.textAlign, el.styles.fontFamily);
    const expected = typography.textAlign;
    // A single-line block that fills its box renders identically whatever the
    // alignment is, so only flag it when it can actually be seen.
    const observable = el.rect.width > 0 && (el.lineCount > 1 || el.rect.width > 40);
    const matches = actual === expected || !observable;
    tests.push(
      buildTest(ctx, {
        category: 'Typography',
        check: 'typography.textAlign',
        title: 'Text alignment',
        pair,
        expected,
        actual,
        difference: matches ? 'exact' : `${expected} → ${actual}`,
        status: matches ? 'PASS' : 'FAIL',
        severity: matches ? 'none' : 'minor',
      }),
    );
  }

  return tests;
}

/** `start`/`end` depend on writing direction; assume LTR, as the design does. */
function normalizeAlign(align: string, _fontFamily: string): string {
  switch (align) {
    case 'start':
      return 'left';
    case 'end':
      return 'right';
    case '':
      return 'left';
    default:
      return align;
  }
}
