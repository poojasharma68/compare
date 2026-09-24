import type { UiTestResult } from '@/lib/types/tests';
import { buildTest, numericTest, type ComparisonContext, type MatchedPair } from './context';

/**
 * Border radius, border width and opacity — the visual finish of an element.
 * Radii and border widths are absolute design decisions, so they are compared
 * unscaled; opacity compares the node's own value, since CSS `opacity` is
 * per-element and the inherited product would not be a like-for-like check.
 */
export function compareStyling(pair: MatchedPair, ctx: ComparisonContext): UiTestResult[] {
  const tests: UiTestResult[] = [];
  const { node, el } = pair;
  const t = ctx.tolerances;

  if (typeof node.borderRadius === 'number') {
    // A radius larger than half the box renders as a pill on both sides; that
    // is the same visual result, so normalize before comparing.
    const cap = Math.min(el.rect.width, el.rect.height) / 2;
    const expected = Math.min(node.borderRadius, Math.min(node.width, node.height) / 2);
    const actual = Math.min(el.styles.borderRadius, cap);

    if (expected > 0 || actual > 0) {
      tests.push(
        numericTest(ctx, {
          category: 'Styling',
          check: 'styling.borderRadius',
          title: 'Border radius',
          pair,
          expected,
          actual,
          tolerance: t.RADIUS_TOLERANCE,
        }),
      );
    }
  }

  const designBorder = node.border?.width ?? 0;
  const domBorder = Math.max(
    el.styles.borderTopWidth,
    el.styles.borderRightWidth,
    el.styles.borderBottomWidth,
    el.styles.borderLeftWidth,
  );
  const domBorderVisible = el.styles.borderStyle !== 'none' && domBorder > 0;

  if (designBorder > 0 || domBorderVisible) {
    tests.push(
      numericTest(ctx, {
        category: 'Styling',
        check: 'styling.borderWidth',
        title: 'Border width',
        pair,
        expected: designBorder,
        actual: domBorderVisible ? domBorder : 0,
        tolerance: t.BORDER_WIDTH_TOLERANCE,
        decimals: 2,
      }),
    );
  }

  // Only worth checking where the design deliberately made something
  // translucent; otherwise every element would produce a trivially passing test.
  if (node.ownOpacity < 0.999 || el.styles.opacity < 0.999) {
    tests.push(
      numericTest(ctx, {
        category: 'Styling',
        check: 'styling.opacity',
        title: 'Opacity',
        pair,
        expected: node.ownOpacity,
        actual: el.styles.opacity,
        tolerance: t.OPACITY_TOLERANCE,
        unit: '',
        decimals: 2,
      }),
    );
  }

  // An image layer in the design should be rendered by a real image element.
  if (node.isImage && node.type === 'IMAGE') {
    const rendersImage = el.isImage || Boolean(el.styles.backgroundImage) || el.tag === 'video' || el.tag === 'canvas';
    tests.push(
      buildTest(ctx, {
        category: 'Styling',
        check: 'styling.imageRendering',
        title: 'Image rendering',
        pair,
        expected: 'rendered as an image',
        actual: rendersImage
          ? el.isImage
            ? `<${el.tag}>`
            : 'CSS background image'
          : `<${el.tag}> with no image`,
        difference: rendersImage ? 'exact' : 'no image source',
        status: rendersImage ? 'PASS' : 'FAIL',
        severity: rendersImage ? 'none' : 'major',
        message: rendersImage
          ? undefined
          : 'The design places an image here but the matched element renders no image.',
      }),
    );

    if (el.isImage && el.naturalWidth === 0) {
      tests.push(
        buildTest(ctx, {
          category: 'Styling',
          check: 'styling.imageBroken',
          title: 'Image loads',
          pair,
          expected: 'image loads successfully',
          actual: 'failed to load',
          difference: 'broken source',
          status: 'FAIL',
          severity: 'critical',
          message: `The image at ${el.src || 'an unknown source'} did not load.`,
        }),
      );
    }
  }

  return tests;
}
