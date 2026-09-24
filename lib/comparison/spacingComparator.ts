import type { DesignNode } from '@/lib/types/figma';
import type { UiTestResult } from '@/lib/types/tests';
import { numericTest, type ComparisonContext, type MatchedPair } from './context';

/**
 * Padding, gap and the distance between sibling elements.
 *
 * Only auto-layout frames carry padding/gap in Figma, so those checks run only
 * where the design actually declares them. Sibling distance is derived
 * geometrically and works for every layout.
 */
export function compareSpacing(pair: MatchedPair, ctx: ComparisonContext): UiTestResult[] {
  const tests: UiTestResult[] = [];
  const { node, el } = pair;
  const t = ctx.tolerances;
  const layout = node.layout;
  if (!layout) return tests;

  const sides = [
    { key: 'paddingTop', label: 'Padding top', design: layout.paddingTop, dom: el.styles.paddingTop },
    { key: 'paddingRight', label: 'Padding right', design: layout.paddingRight, dom: el.styles.paddingRight },
    { key: 'paddingBottom', label: 'Padding bottom', design: layout.paddingBottom, dom: el.styles.paddingBottom },
    { key: 'paddingLeft', label: 'Padding left', design: layout.paddingLeft, dom: el.styles.paddingLeft },
  ] as const;

  for (const side of sides) {
    if (typeof side.design !== 'number') continue;
    tests.push(
      numericTest(ctx, {
        category: 'Spacing',
        check: `spacing.${side.key}`,
        title: side.label,
        pair,
        expected: side.design * ctx.scale,
        actual: side.dom,
        tolerance: t.PADDING_TOLERANCE,
      }),
    );
  }

  if (typeof layout.gap === 'number' && layout.direction !== 'none') {
    const domGap = resolveDomGap(pair, ctx, layout.direction === 'row');
    if (domGap !== null) {
      tests.push(
        numericTest(ctx, {
          category: 'Spacing',
          check: 'spacing.gap',
          title: `Gap between ${layout.direction === 'row' ? 'columns' : 'rows'}`,
          pair,
          expected: layout.gap * ctx.scale,
          actual: domGap.value,
          tolerance: t.GAP_TOLERANCE,
          note: domGap.derived
            ? 'No CSS gap is declared; measured from the distance between the first two children.'
            : undefined,
        }),
      );
    }
  }

  return tests;
}

/**
 * Reads the CSS `gap` when one is declared, otherwise measures the actual
 * distance between the first two laid-out children. Sites built with margins
 * rather than gap still get a meaningful check this way.
 */
function resolveDomGap(
  pair: MatchedPair,
  ctx: ComparisonContext,
  horizontal: boolean,
): { value: number; derived: boolean } | null {
  const declared = pair.el.styles.gap;
  if (typeof declared === 'number' && declared > 0) return { value: declared, derived: false };

  const children = pair.el.childIndexes
    .map((i) => ctx.domByIndex.get(i))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .sort((a, b) => (horizontal ? a.rect.x - b.rect.x : a.rect.y - b.rect.y));

  if (children.length < 2) return null;
  const [first, second] = children;
  const value = horizontal
    ? second.rect.x - (first.rect.x + first.rect.width)
    : second.rect.y - (first.rect.y + first.rect.height);

  if (!Number.isFinite(value) || value < 0) return null;
  return { value, derived: true };
}

/** Above this, a vertical gap is section spacing rather than local rhythm. */
const SECTION_GAP_LIMIT = 160;

/**
 * Compares the distance between consecutive matched siblings. Catches spacing
 * drift in layouts that Figma did not express as auto-layout.
 */
export function compareSiblingDistances(ctx: ComparisonContext): UiTestResult[] {
  const tests: UiTestResult[] = [];
  const t = ctx.tolerances;

  // Group matched pairs by their design parent.
  const byParent = new Map<string, MatchedPair[]>();
  for (const pair of ctx.pairByNodeId.values()) {
    const parentId = pair.node.parentId;
    if (!parentId) continue;
    const bucket = byParent.get(parentId);
    if (bucket) bucket.push(pair);
    else byParent.set(parentId, [pair]);
  }

  for (const [parentId, siblings] of byParent) {
    if (siblings.length < 2) continue;
    const parent: DesignNode | undefined = ctx.nodeById.get(parentId);
    if (!parent) continue;

    // Only vertical stacks: horizontal rows reflow far too readily for a
    // gap delta to mean anything on its own.
    const stacked = siblings
      .filter((p) => p.node.significance >= 0.5)
      .sort((a, b) => a.node.y - b.node.y);
    if (stacked.length < 2) continue;

    for (let i = 0; i < stacked.length - 1 && i < 6; i++) {
      const a = stacked[i];
      const b = stacked[i + 1];

      const designGap = b.node.y - (a.node.y + a.node.height);
      const domGap = b.el.rect.y - (a.el.rect.y + a.el.rect.height);
      // Overlapping or side-by-side nodes are not a vertical rhythm.
      if (designGap < 0 || domGap < -4) continue;
      const horizontallyDisjoint =
        b.node.x >= a.node.x + a.node.width - 2 || a.node.x >= b.node.x + b.node.width - 2;
      if (horizontallyDisjoint) continue;

      // The two must also be siblings on the page. If the design places them
      // next to each other but the page nests them differently, the distance
      // between them is a structural difference, not a spacing one — and
      // structure.hierarchy already reports that.
      if (a.el.parentIndex === null || a.el.parentIndex !== b.el.parentIndex) continue;

      // Section-level gaps vary legitimately with content length. This check is
      // for local rhythm — the 8px that should have been 16px.
      if (designGap > SECTION_GAP_LIMIT) continue;

      tests.push(
        numericTest(ctx, {
          category: 'Spacing',
          check: 'spacing.siblingDistance',
          title: `Space below "${a.node.name}"`,
          pair: a,
          expected: designGap * ctx.scale,
          actual: domGap,
          tolerance: t.GAP_TOLERANCE * 1.5,
          note: `Vertical distance to the next element, "${b.node.name}".`,
        }),
      );
    }
  }

  return tests;
}
