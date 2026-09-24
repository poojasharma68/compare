import type { DomElement } from '@/lib/types/dom';
import type { ResponsiveTestResult } from '@/lib/types/tests';
import { buildResponsiveTest, isAncestorOf, px, round, type ResponsiveContext } from './context';

const MAX_REPORTED = 6;

/**
 * Detects elements that collide when they should not.
 *
 * Intentional overlap is everywhere on the modern web — badges on cards, icons
 * inside buttons, text over hero imagery, sticky headers — so this detector is
 * deliberately conservative. A pair is only reported when *both* elements are
 * in normal document flow, neither contains the other, and neither is doing
 * anything that signals deliberate stacking.
 */
export function detectOverlap(ctx: ResponsiveContext): ResponsiveTestResult[] {
  const candidates = ctx.snapshot.elements
    .filter((el) => isFlowElement(el))
    .filter((el) => el.rect.width * el.rect.height >= ctx.tolerances.OVERLAP_MIN_AREA)
    .filter((el) => el.significance >= 0.45)
    .sort((a, b) => a.rect.y - b.rect.y);

  const collisions: Array<{ a: DomElement; b: DomElement; ratio: number; overlapArea: number }> = [];

  // Sweep by vertical position: only elements whose Y ranges intersect can
  // collide, which keeps this far below the naive O(n²).
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      if (b.rect.y >= a.rect.bottom) break;

      const overlapArea = intersectionArea(a, b);
      if (overlapArea <= 0) continue;

      const minArea = Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);
      const ratio = overlapArea / minArea;
      if (ratio < ctx.tolerances.OVERLAP_AREA_RATIO) continue;

      if (!isUnintentional(a, b, ctx)) continue;
      collisions.push({ a, b, ratio, overlapArea });
    }
  }

  collisions.sort((x, y) => y.ratio - x.ratio);

  if (collisions.length === 0) {
    return [
      buildResponsiveTest(ctx, {
        category: 'Overlap',
        check: 'overlap.elements',
        title: 'No unintended element overlap',
        element: 'all elements',
        expected: 'Elements in normal flow do not collide',
        actual: 'No unintended collisions detected',
        difference: 'none',
        status: 'PASS',
        severity: 'none',
      }),
    ];
  }

  return collisions.slice(0, MAX_REPORTED).map((collision) => {
    const percent = Math.round(collision.ratio * 100);
    const severity = percent >= 60 ? 'critical' : percent >= 35 ? 'major' : 'minor';
    return buildResponsiveTest(ctx, {
      category: 'Overlap',
      check: 'overlap.elements',
      title: 'Elements overlap',
      element: `${collision.a.label} ↔ ${collision.b.label}`,
      selector: collision.a.selector,
      expected: 'No overlap between these elements',
      actual: `${percent}% of ${smallerLabel(collision.a, collision.b)} is covered (${px(
        Math.sqrt(collision.overlapArea),
      )}² of overlap)`,
      difference: `${percent}% overlap`,
      delta: round(collision.ratio, 3),
      status: severity === 'minor' ? 'WARNING' : 'FAIL',
      severity,
      message: `${collision.a.label} and ${collision.b.label} are both in normal document flow yet occupy the same space. At this viewport their content collides.`,
      highlight: collision.a,
    });
  });
}

function smallerLabel(a: DomElement, b: DomElement): string {
  const areaA = a.rect.width * a.rect.height;
  const areaB = b.rect.width * b.rect.height;
  return areaA <= areaB ? a.label : b.label;
}

function intersectionArea(a: DomElement, b: DomElement): number {
  const x = Math.max(0, Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left));
  const y = Math.max(0, Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top));
  return x * y;
}

/** Only elements laid out by normal flow can "accidentally" collide. */
function isFlowElement(el: DomElement): boolean {
  const position = el.styles.position;
  if (position === 'absolute' || position === 'fixed' || position === 'sticky') return false;
  if (el.positionedAncestor) return false;
  // An explicit stacking order is a statement of intent.
  if (el.styles.zIndex !== 'auto' && el.styles.zIndex !== '') return false;
  if (el.styles.transform) return false;
  if (el.styles.display.startsWith('inline')) return false;
  if (el.styles.float && el.styles.float !== 'none') return false;
  return true;
}

/**
 * Filters the remaining false-positive classes: nesting, geometric
 * containment (a card behind its own content), negative margins used as a
 * deliberate pull, and table/grid cells that share edges.
 */
function isUnintentional(a: DomElement, b: DomElement, ctx: ResponsiveContext): boolean {
  if (isAncestorOf(a, b, ctx) || isAncestorOf(b, a, ctx)) return false;

  // One fully inside the other is normally a backdrop/content relationship —
  // unless they are siblings, in which case two boxes sharing the same slot
  // (a grid cell holding two items, say) really is a collision.
  const siblings = a.parentIndex !== null && a.parentIndex === b.parentIndex;
  if (!siblings && (contains(a, b) || contains(b, a))) return false;

  // Negative margins are an explicit "pull this over" instruction.
  if (hasNegativeMargin(a) || hasNegativeMargin(b)) return false;

  // Shared-edge rounding in tables and grids is not a collision.
  if (isTablePart(a) || isTablePart(b)) return false;

  // Decorative vectors overlapping content is a styling choice, not a break.
  if (a.tag === 'svg' || b.tag === 'svg') return false;

  return true;
}

function contains(outer: DomElement, inner: DomElement): boolean {
  const pad = 2;
  return (
    inner.rect.left >= outer.rect.left - pad &&
    inner.rect.right <= outer.rect.right + pad &&
    inner.rect.top >= outer.rect.top - pad &&
    inner.rect.bottom <= outer.rect.bottom + pad
  );
}

function hasNegativeMargin(el: DomElement): boolean {
  return (
    el.styles.marginTop < -1 ||
    el.styles.marginBottom < -1 ||
    el.styles.marginLeft < -1 ||
    el.styles.marginRight < -1
  );
}

function isTablePart(el: DomElement): boolean {
  return el.tag === 'td' || el.tag === 'th' || el.tag === 'tr' || el.styles.display.startsWith('table');
}
