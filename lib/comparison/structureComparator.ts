import type { DesignNode } from '@/lib/types/figma';
import type { MatchingSummary, UiTestResult } from '@/lib/types/tests';
import { truncate } from '@/lib/utils/text';
import type { ComparisonContext, MatchedPair } from './context';

/**
 * Structural checks: layers the page never renders, page elements the design
 * never described, and pairs whose nesting disagrees with the design.
 *
 * Missing/extra findings come from the matcher, which already collapses whole
 * unmatched subtrees into a single report so one absent section does not
 * produce fifty findings.
 */
export function compareStructure(
  matching: MatchingSummary,
  ctx: ComparisonContext,
): UiTestResult[] {
  const tests: UiTestResult[] = [];

  for (const missing of matching.missing) {
    const node = ctx.nodeById.get(missing.figmaNodeId);
    // An uncertain match is never a failure: something is probably there, we
    // just cannot prove which element it is.
    const severity = missing.uncertain ? 'minor' : missingSeverity(node);
    tests.push({
      kind: 'ui',
      id: ctx.nextId(),
      title: missing.uncertain ? 'Element could not be confidently located' : 'Missing element',
      check: missing.uncertain ? 'structure.uncertain' : 'structure.missing',
      category: 'Structure',
      element: missing.name,
      expected: node?.text
        ? `An element rendering "${truncate(node.text, 60)}"`
        : `A ${missing.type.toLowerCase()} element from the design`,
      actual: missing.uncertain
        ? `best candidate matched at ${Math.round((missing.confidence ?? 0) * 100)}% confidence`
        : 'not found on the page',
      difference: missing.uncertain ? 'low confidence' : 'missing',
      severity,
      status: severity === 'minor' ? 'WARNING' : 'FAIL',
      message: missing.reason,
      figmaNodeId: missing.figmaNodeId,
      figmaNodeName: missing.name,
      confidence: missing.confidence,
    });
  }

  // When the page has far more unmatched content than matched content, the
  // design almost certainly describes a different (or partial) screen. Listing
  // every unmatched paragraph would drown the findings that matter, so the
  // whole set collapses into one honest summary.
  const extrasDominate =
    matching.extra.length > Math.max(8, matching.matches.length * 1.5);

  if (extrasDominate) {
    tests.push({
      kind: 'ui',
      id: ctx.nextId(),
      title: 'Page contains substantially more content than the design',
      check: 'structure.extra',
      category: 'Structure',
      element: 'document',
      expected: `Content roughly matching the ${matching.matches.length} matched layers`,
      actual: `${matching.extra.length} meaningful elements have no counterpart in the design`,
      difference: `${matching.extra.length} unmatched`,
      severity: 'minor',
      status: 'WARNING',
      message:
        `Only ${matching.matches.length} design layers matched against ${matching.consideredDomElements} page elements. ` +
        'The linked frame probably covers a different screen, or only part of this one. Individual extra elements are not listed.',
    });
  }

  for (const extra of extrasDominate ? [] : matching.extra) {
    const el = ctx.domByIndex.get(extra.domIndex);
    tests.push({
      kind: 'ui',
      id: ctx.nextId(),
      title: 'Extra element',
      check: 'structure.extra',
      category: 'Structure',
      element: extra.label,
      selector: extra.selector,
      expected: 'no counterpart required',
      actual: el?.ownText ? `renders "${truncate(el.ownText, 60)}"` : `<${el?.tag ?? 'element'}> on the page`,
      difference: 'not in the design',
      // Extra content is frequently intentional (legal text, live data), so
      // this is always a warning and never fails the audit on its own.
      severity: 'minor',
      status: 'WARNING',
      message: extra.reason,
    });
  }

  tests.push(...compareHierarchy(ctx));

  return tests;
}

/**
 * Flags pairs whose DOM element is not nested under the element its design
 * parent matched to. Restricted to high-confidence pairs: a hierarchy claim
 * built on a shaky match would be worse than no claim at all.
 */
function compareHierarchy(ctx: ComparisonContext): UiTestResult[] {
  const tests: UiTestResult[] = [];
  const threshold = ctx.tolerances.STRICT_MATCH_THRESHOLD;

  for (const pair of ctx.pairByNodeId.values()) {
    if (pair.match.confidence < threshold) continue;
    const parentId = pair.node.parentId;
    if (!parentId) continue;

    const parentPair = ctx.pairByNodeId.get(parentId);
    if (!parentPair || parentPair.match.confidence < threshold) continue;

    if (isDescendant(pair, parentPair, ctx)) continue;

    // Containment in the design implies containment on the page. When the
    // design boxes do not nest either, there is nothing to report.
    if (!designContains(parentPair.node, pair.node)) continue;

    tests.push({
      kind: 'ui',
      id: ctx.nextId(),
      title: 'Incorrect hierarchy',
      check: 'structure.hierarchy',
      category: 'Structure',
      element: pair.node.name,
      selector: pair.el.selector,
      expected: `nested inside "${parentPair.node.name}" (${parentPair.el.label})`,
      actual: `rendered outside ${parentPair.el.label}`,
      difference: 'nesting differs',
      severity: 'minor',
      status: 'WARNING',
      message:
        'The design nests this layer inside its parent, but on the page the two are siblings or otherwise unrelated. ' +
        'This often still looks right while making the layout fragile.',
      figmaNodeId: pair.node.id,
      figmaNodeName: pair.node.name,
      confidence: pair.match.confidence,
    });
  }

  return tests.slice(0, 20);
}

function isDescendant(pair: MatchedPair, ancestor: MatchedPair, ctx: ComparisonContext): boolean {
  let index: number | null = pair.el.parentIndex;
  let guard = 0;
  while (index !== null && index !== undefined && guard++ < 40) {
    if (index === ancestor.el.index) return true;
    index = ctx.domByIndex.get(index)?.parentIndex ?? null;
  }
  return false;
}

function designContains(parent: DesignNode, child: DesignNode): boolean {
  const pad = 2;
  return (
    child.x >= parent.x - pad &&
    child.y >= parent.y - pad &&
    child.x + child.width <= parent.x + parent.width + pad &&
    child.y + child.height <= parent.y + parent.height + pad
  );
}

/** Larger, more prominent layers matter more when they are absent. */
function missingSeverity(node: DesignNode | undefined): 'minor' | 'major' | 'critical' {
  if (!node) return 'minor';
  if (node.significance >= 0.8) return 'critical';
  if (node.significance >= 0.6) return 'major';
  return 'minor';
}
