import type { DesignNode, DesignTree } from '@/lib/types/figma';
import type { DomElement, PageSnapshot } from '@/lib/types/dom';
import type { ElementMatch, FrameRegistration, MatchingSummary } from '@/lib/types/tests';
import type { Tolerances } from '@/lib/config/tolerances';
import { tokenize } from '@/lib/utils/text';
import {
  clamp01,
  geometryScore,
  identityMapping,
  nameScore,
  textScore,
  typeScore,
  type ScaleContext,
} from './similarity';

/** Candidate cap per design node — keeps scoring bounded on large pages. */
const MAX_CANDIDATES = 40;
/** Pairs below this never enter the assignment pool, whatever the threshold. */
const SCORE_FLOOR = 0.32;
const SPATIAL_CELL = 240;
const MAX_EXTRAS_REPORTED = 30;

/** Types we never require the DOM to reproduce one-to-one. */
const NON_TESTABLE_TYPES = new Set(['VECTOR', 'OTHER']);

/** DOM elements that exist for reasons a design never shows. */
const CHROME_PATTERN =
  /(cookie|consent|gdpr|banner-privacy|onetrust|cookiebot|skip-link|skip-to|sr-only|visually-hidden|screen-reader|toast|notification-bar|chat-widget|intercom|drift|livechat)/i;

interface Candidate {
  node: DesignNode;
  el: DomElement;
  score: number;
  signals: Record<string, number>;
}

export interface MatchOptions {
  tolerances: Tolerances;
  scale: number;
}

/**
 * Matches Figma nodes to DOM elements using several weighted signals rather
 * than one. Runs in two passes: the first scores text/type/geometry/name, the
 * second re-scores whatever is left with hierarchy context from pass one, so a
 * child benefits from its parent already being placed.
 */
export function matchElements(
  design: DesignTree,
  snapshot: PageSnapshot,
  options: MatchOptions,
): MatchingSummary {
  const { tolerances, scale } = options;

  const designNodes = design.nodes.filter(
    (n) => n.id !== design.rootId && !NON_TESTABLE_TYPES.has(n.type) && n.width >= 4 && n.height >= 4,
  );
  const domElements = snapshot.elements;
  const index = buildIndexes(domElements);

  const baseCtx = {
    scale,
    viewportWidth: snapshot.viewport.width,
    designHeightPx: design.rootHeight * scale,
  };

  // ---- Pass 1: text-bearing layers, before any registration ---------------
  // Copy is location-independent, so these match reliably even when the two
  // coordinate systems have drifted apart. They are what registration is then
  // fitted from.
  const unregistered: ScaleContext = { ...baseCtx, ...identityMapping(scale) };
  const textNodes = designNodes.filter((n) => Boolean(n.text));

  const textPairs: Candidate[] = [];
  for (const node of textNodes) {
    for (const el of candidatesFor(node, domElements, index, unregistered)) {
      const scored = scorePair(node, el, unregistered, null);
      if (scored.score >= SCORE_FLOOR) textPairs.push(scored);
    }
  }

  const firstPass = assign(textPairs, tolerances.MATCH_THRESHOLD);

  // ---- Registration: fit design coordinates onto the page -----------------
  const nodeById = new Map(design.nodes.map((n) => [n.id, n]));
  const domByIndex = new Map(domElements.map((e) => [e.index, e]));
  const fitted = fitMapping(firstPass, nodeById, domByIndex, tolerances, scale);
  const registered: ScaleContext = { ...baseCtx, ...fitted.mapping };

  const registration: FrameRegistration = {
    top: Math.round(fitted.mapping.mapY(0)),
    bottom: Math.round(fitted.mapping.mapY(design.rootHeight)),
    offsetX: Math.round(fitted.offsetX),
    slopeY: Number(fitted.slopeY.toFixed(3)),
    anchors: fitted.anchors,
  };

  // ---- Pass 2: everything else, with registration and hierarchy context ---
  const hierarchy: HierarchyContext = {
    figmaToDom: firstPass.figmaToDom,
    nodeById,
    domByIndex,
  };

  const secondPairs: Candidate[] = [];
  for (const node of designNodes) {
    if (firstPass.figmaToDom.has(node.id)) continue;
    for (const el of candidatesFor(node, domElements, index, registered)) {
      if (firstPass.domToFigma.has(el.index)) continue;
      const scored = scorePair(node, el, registered, hierarchy);
      if (scored.score >= SCORE_FLOOR) secondPairs.push(scored);
    }
  }

  const secondPass = assign(secondPairs, tolerances.MATCH_THRESHOLD, firstPass);

  const matches: ElementMatch[] = secondPass.matches
    .slice()
    .sort((a, b) => b.confidence - a.confidence);

  const confidenceByNode = new Map(matches.map((m) => [m.figmaNodeId, m.confidence]));
  const matchedDom = new Set(matches.map((m) => m.domIndex));

  return {
    matches,
    missing: collectMissing(designNodes, confidenceByNode, tolerances),
    extra: collectExtra(domElements, matchedDom, design, registered, tolerances),
    registration,
    consideredFigmaNodes: designNodes.length,
    consideredDomElements: domElements.length,
    averageConfidence: matches.length
      ? Number((matches.reduce((sum, m) => sum + m.confidence, 0) / matches.length).toFixed(3))
      : 0,
  };
}

/* -------------------------------------------------------------------------- */
/*                             Candidate generation                           */
/* -------------------------------------------------------------------------- */

interface DomIndexes {
  byToken: Map<string, number[]>;
  spatial: Map<string, number[]>;
  byTag: Map<string, number[]>;
}

function buildIndexes(elements: DomElement[]): DomIndexes {
  const byToken = new Map<string, number[]>();
  const spatial = new Map<string, number[]>();
  const byTag = new Map<string, number[]>();

  elements.forEach((el, i) => {
    for (const token of new Set(tokenize(el.ownText || el.text).slice(0, 24))) {
      if (token.length < 3) continue;
      const bucket = byToken.get(token);
      if (bucket) bucket.push(i);
      else byToken.set(token, [i]);
    }

    for (const key of cellsFor(el.rect.x, el.rect.y, el.rect.width, el.rect.height)) {
      const bucket = spatial.get(key);
      if (bucket) bucket.push(i);
      else spatial.set(key, [i]);
    }

    const tagBucket = byTag.get(el.tag);
    if (tagBucket) tagBucket.push(i);
    else byTag.set(el.tag, [i]);
  });

  return { byToken, spatial, byTag };
}

function cellsFor(x: number, y: number, width: number, height: number): string[] {
  const keys: string[] = [];
  const x0 = Math.floor(x / SPATIAL_CELL);
  const x1 = Math.floor((x + width) / SPATIAL_CELL);
  const y0 = Math.floor(y / SPATIAL_CELL);
  const y1 = Math.floor((y + height) / SPATIAL_CELL);
  // A huge element would otherwise be registered in hundreds of cells.
  const maxSpan = 24;
  for (let cx = x0; cx <= Math.min(x1, x0 + maxSpan); cx++) {
    for (let cy = y0; cy <= Math.min(y1, y0 + maxSpan); cy++) {
      keys.push(`${cx}:${cy}`);
    }
  }
  return keys;
}

/**
 * Narrows the DOM to a plausible shortlist for one design node: text-token
 * hits first, then elements occupying the same region of the layout.
 */
function candidatesFor(
  node: DesignNode,
  elements: DomElement[],
  index: DomIndexes,
  ctx: ScaleContext,
): DomElement[] {
  const seen = new Set<number>();
  const out: DomElement[] = [];

  const push = (i: number) => {
    if (seen.has(i) || out.length >= MAX_CANDIDATES) return;
    seen.add(i);
    out.push(elements[i]);
  };

  if (node.text) {
    const tokens = tokenize(node.text).filter((t) => t.length >= 3).slice(0, 8);
    const hitCounts = new Map<number, number>();
    for (const token of tokens) {
      for (const i of index.byToken.get(token) ?? []) {
        hitCounts.set(i, (hitCounts.get(i) ?? 0) + 1);
      }
    }
    const ranked = [...hitCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_CANDIDATES);
    for (const [i] of ranked) push(i);
  }

  // Spatial neighbourhood around where the design says this node should be.
  const expX = ctx.mapX(node.x);
  const expY = ctx.mapY(node.y);
  const expW = node.width * ctx.scale;
  const expH = node.height * ctx.scale;
  const pad = SPATIAL_CELL;
  for (const key of cellsFor(expX - pad, expY - pad, expW + pad * 2, expH + pad * 2)) {
    for (const i of index.spatial.get(key) ?? []) push(i);
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/*                                Registration                                */
/* -------------------------------------------------------------------------- */

/**
 * Fits `pageY = a . designY + b` from the confident text matches, so the rest
 * of the page can be searched where its content actually is.
 *
 * Uses a Theil-Sen estimator (median of pairwise slopes) rather than least
 * squares: a handful of genuinely misplaced elements are exactly what we are
 * looking for, and they must not be allowed to drag the reference frame onto
 * themselves and hide the error.
 */
interface FittedMapping {
  mapping: Pick<ScaleContext, 'mapX' | 'mapY'>;
  offsetX: number;
  slopeY: number;
  anchors: number;
}

function fitMapping(
  pass: AssignmentState,
  nodeById: Map<string, DesignNode>,
  domByIndex: Map<number, DomElement>,
  tolerances: Tolerances,
  scale: number,
): FittedMapping {
  const points: Array<{ dy: number; py: number; dx: number; px: number }> = [];

  for (const match of pass.matches) {
    if (match.confidence < tolerances.STRICT_MATCH_THRESHOLD) continue;
    const node = nodeById.get(match.figmaNodeId);
    const el = domByIndex.get(match.domIndex);
    if (!node || !el) continue;
    points.push({ dy: node.y, py: el.rect.y, dx: node.x, px: el.rect.x });
  }

  if (points.length < 4) {
    // Not enough anchors to fit a slope; fall back to plain scaling plus a
    // constant offset if we have any samples at all.
    if (points.length === 0) {
      return { mapping: identityMapping(scale), offsetX: 0, slopeY: scale, anchors: 0 };
    }
    const offsetY = median(points.map((p) => p.py - p.dy * scale));
    const offsetX = median(points.map((p) => p.px - p.dx * scale));
    return {
      mapping: {
        mapX: (x) => x * scale + offsetX,
        mapY: (y) => y * scale + offsetY,
      },
      offsetX,
      slopeY: scale,
      anchors: points.length,
    };
  }

  points.sort((a, b) => a.dy - b.dy);
  const sample = points.length > 120 ? downsample(points, 120) : points;

  const slopes: number[] = [];
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const dd = sample[j].dy - sample[i].dy;
      // Pairs too close together produce wildly unstable slopes.
      if (Math.abs(dd) < 40) continue;
      slopes.push((sample[j].py - sample[i].py) / dd);
    }
  }

  // Keep the fit physically plausible: a page is not four times its design.
  const slopeY = slopes.length > 0 ? clamp(median(slopes), 0.4, 3) : scale;
  const interceptY = median(sample.map((p) => p.py - slopeY * p.dy));
  const offsetX = median(sample.map((p) => p.px - p.dx * scale));

  return {
    mapping: {
      mapX: (x) => x * scale + offsetX,
      mapY: (y) => y * slopeY + interceptY,
    },
    offsetX,
    slopeY,
    anchors: points.length,
  };
}

function downsample<T>(values: T[], count: number): T[] {
  const step = values.length / count;
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(values[Math.floor(i * step)]);
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* -------------------------------------------------------------------------- */
/*                                  Scoring                                   */
/* -------------------------------------------------------------------------- */

interface HierarchyContext {
  figmaToDom: Map<string, number>;
  nodeById: Map<string, DesignNode>;
  domByIndex: Map<number, DomElement>;
}

function scorePair(
  node: DesignNode,
  el: DomElement,
  ctx: ScaleContext,
  hierarchy: HierarchyContext | null,
): Candidate {
  const type = typeScore(node, el);
  const geometry = geometryScore(node, el, ctx);
  const name = nameScore(node, el);
  const text = node.text ? textScore(node, el) : 0;
  const hierarchyValue = hierarchy ? hierarchyScore(node, el, hierarchy) : 0;

  // Weights shift with what the node actually offers: a TEXT layer is
  // identified mostly by its copy, a frame mostly by its box.
  const signals: Record<string, number> = { type, geometry, name };
  let score: number;

  if (node.text) {
    signals.text = text;
    score = 0.44 * text + 0.14 * type + 0.28 * geometry + 0.14 * name;
    // Copy that clearly differs should not be rescued by geometry alone.
    if (text < 0.25) score *= 0.55;
  } else {
    score = 0.22 * type + 0.58 * geometry + 0.2 * name;
    // "There is a box roughly here" is not evidence on its own. Without text,
    // a match needs the element type or the layer name to agree as well —
    // otherwise any absent layer silently adopts whatever happens to sit in
    // the same region, and a genuinely missing element is never reported.
    if (type < 0.5 && name < 0.35) score *= 0.6;
  }

  if (hierarchy) {
    signals.hierarchy = hierarchyValue;
    score = score * 0.85 + hierarchyValue * 0.15;
  }

  // Type incompatibility is close to disqualifying regardless of other signals.
  if (type <= 0.15) score *= 0.4;

  return { node, el, score: clamp01(score), signals };
}

/** 1 when the DOM element sits under the parent's already-matched element. */
function hierarchyScore(node: DesignNode, el: DomElement, ctx: HierarchyContext): number {
  if (!node.parentId) return 0.4;
  const parentDomIndex = ctx.figmaToDom.get(node.parentId);
  if (parentDomIndex === undefined) return 0.4;

  let current: DomElement | undefined = el;
  let steps = 0;
  while (current && steps < 20) {
    if (current.index === parentDomIndex) return steps <= 2 ? 1 : 0.8;
    if (current.parentIndex === null) break;
    current = ctx.domByIndex.get(current.parentIndex);
    steps++;
  }
  return 0.1;
}

/* -------------------------------------------------------------------------- */
/*                            One-to-one assignment                           */
/* -------------------------------------------------------------------------- */

interface AssignmentState {
  matches: ElementMatch[];
  figmaToDom: Map<string, number>;
  domToFigma: Map<number, string>;
}

/**
 * Greedy highest-confidence-first assignment. Exact optimality is not worth the
 * cost here: scores are well separated in practice, and greedy keeps the engine
 * predictable and fast.
 */
function assign(pairs: Candidate[], threshold: number, seed?: AssignmentState): AssignmentState {
  const state: AssignmentState = seed
    ? { matches: [...seed.matches], figmaToDom: new Map(seed.figmaToDom), domToFigma: new Map(seed.domToFigma) }
    : { matches: [], figmaToDom: new Map(), domToFigma: new Map() };

  const sorted = pairs.slice().sort((a, b) => b.score - a.score);
  for (const pair of sorted) {
    if (pair.score < threshold) break;
    if (state.figmaToDom.has(pair.node.id)) continue;
    if (state.domToFigma.has(pair.el.index)) continue;

    state.figmaToDom.set(pair.node.id, pair.el.index);
    state.domToFigma.set(pair.el.index, pair.node.id);
    state.matches.push({
      figmaNodeId: pair.node.id,
      figmaNodeName: pair.node.name,
      domIndex: pair.el.index,
      domSelector: pair.el.selector,
      domLabel: pair.el.label,
      confidence: Number(pair.score.toFixed(3)),
      signals: Object.fromEntries(
        Object.entries(pair.signals).map(([k, v]) => [k, Number(v.toFixed(3))]),
      ),
    });
  }

  return state;
}

/* -------------------------------------------------------------------------- */
/*                             Missing / extra                                */
/* -------------------------------------------------------------------------- */

/**
 * Reports only the topmost unmatched node of any unmatched subtree — otherwise
 * one missing section would produce dozens of duplicate findings.
 */
function collectMissing(
  nodes: DesignNode[],
  confidenceByNode: Map<string, number>,
  tolerances: Tolerances,
): MatchingSummary['missing'] {
  // A pairing below the strict threshold is a guess, not a confirmation, so it
  // does not count as "found". Reporting it as uncertain rather than missing
  // keeps the finding honest in both directions.
  const unmatched = new Set(
    nodes
      .filter((n) => (confidenceByNode.get(n.id) ?? 0) < tolerances.STRICT_MATCH_THRESHOLD)
      .map((n) => n.id),
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: MatchingSummary['missing'] = [];

  for (const node of nodes) {
    if (!unmatched.has(node.id)) continue;
    if (node.significance < tolerances.MIN_FIGMA_SIGNIFICANCE) continue;

    // Skip when an ancestor is already reported as missing.
    let ancestorId = node.parentId;
    let covered = false;
    let guard = 0;
    while (ancestorId && guard++ < 30) {
      if (unmatched.has(ancestorId)) {
        const ancestor = byId.get(ancestorId);
        if (ancestor && ancestor.significance >= tolerances.MIN_FIGMA_SIGNIFICANCE) {
          covered = true;
          break;
        }
      }
      ancestorId = byId.get(ancestorId)?.parentId ?? null;
    }
    if (covered) continue;

    const confidence = confidenceByNode.get(node.id);
    const uncertain = confidence !== undefined;

    out.push({
      figmaNodeId: node.id,
      name: node.name,
      type: node.type,
      uncertain,
      confidence,
      reason: uncertain
        ? `The closest candidate on the page matched at only ${Math.round((confidence ?? 0) * 100)}% confidence, which is too low to compare against.`
        : node.text
          ? `No element on the page renders the text "${node.text.slice(0, 60)}".`
          : `No element matches this ${node.type.toLowerCase()} at ${Math.round(node.width)}×${Math.round(node.height)}.`,
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 40);
}

/**
 * Meaningful page elements with no design counterpart. Restricted to the region
 * the design actually covers, and to elements that are not descendants of
 * another reported extra.
 */
function collectExtra(
  elements: DomElement[],
  matched: Set<number>,
  design: DesignTree,
  ctx: ScaleContext,
  tolerances: Tolerances,
): MatchingSummary['extra'] {
  // The page band the design frame actually covers.
  //
  // A frame is frequently one section of a longer page, so this band has a top
  // edge as well as a bottom one. Without the top edge every header, nav link
  // and hero element above the section gets reported as "not in the design" —
  // which is true but useless, because that content was never in scope.
  const frameHeight = Math.max(1, ctx.mapY(design.rootHeight) - ctx.mapY(0));
  const margin = Math.min(160, frameHeight * 0.1);
  const designTop = ctx.mapY(0) - margin;
  const designBottom = ctx.mapY(design.rootHeight) + margin;
  const reported = new Set<number>();
  const byIndex = new Map(elements.map((e) => [e.index, e]));
  const out: MatchingSummary['extra'] = [];

  const ranked = elements
    .filter((el) => !matched.has(el.index))
    .filter((el) => el.significance >= tolerances.MIN_DOM_SIGNIFICANCE)
    .filter((el) => el.rect.bottom > designTop && el.rect.y < designBottom)
    .filter((el) => Boolean(el.ownText) || el.isImage || el.isInteractive)
    .filter((el) => !CHROME_PATTERN.test(`${el.id ?? ''} ${el.classList.join(' ')}`))
    .sort((a, b) => b.significance - a.significance);

  for (const el of ranked) {
    if (out.length >= MAX_EXTRAS_REPORTED) break;

    let parent = el.parentIndex;
    let covered = false;
    let guard = 0;
    while (parent !== null && parent !== undefined && guard++ < 30) {
      if (reported.has(parent)) {
        covered = true;
        break;
      }
      parent = byIndex.get(parent)?.parentIndex ?? null;
    }
    if (covered) continue;

    reported.add(el.index);
    out.push({
      domIndex: el.index,
      selector: el.selector,
      label: el.label,
      reason: el.ownText
        ? `Renders "${el.ownText.slice(0, 60)}" with no matching layer in the design.`
        : `A ${el.tag} of ${Math.round(el.rect.width)}×${Math.round(el.rect.height)} has no matching layer in the design.`,
    });
  }

  return out;
}
