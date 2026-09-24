import type { FigmaNode, FigmaPaint, FigmaRect } from '@/lib/types/figma';
import { figmaColorToRgba, formatRgba, type Rgba } from '@/lib/utils/color';

export interface FrameCandidate {
  node: FigmaNode;
  id: string;
  name: string;
  width: number;
  height: number;
  pageName: string;
  score: number;
}

const FRAME_TYPES = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION']);

/** Names that usually mark the "real" screen rather than a scratch artboard. */
const POSITIVE_NAME_HINTS = /\b(desktop|web|home|landing|page|screen|main|hero|index|layout|1440|1920|1280)\b/i;
const NEGATIVE_NAME_HINTS = /\b(icon|logo|asset|style|guide|color|typograph|component|symbol|archive|old|wip|draft|token|spec)\b/i;

/**
 * Walks the pages of a Figma document and collects every top-level frame that
 * could plausibly be the audited screen.
 */
export function collectFrameCandidates(document: FigmaNode): FrameCandidate[] {
  const candidates: FrameCandidate[] = [];
  const pages = document.children ?? [];

  for (const page of pages) {
    if (page.visible === false) continue;
    const children = page.children ?? [];
    for (const child of children) {
      pushCandidate(child, page.name ?? 'Page', candidates);
      // SECTIONs wrap frames; look one level deeper so they are not missed.
      if (child.type === 'SECTION') {
        for (const grandchild of child.children ?? []) {
          pushCandidate(grandchild, page.name ?? 'Page', candidates);
        }
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

function pushCandidate(node: FigmaNode, pageName: string, out: FrameCandidate[]): void {
  if (!FRAME_TYPES.has(node.type) || node.type === 'SECTION') return;
  if (node.visible === false) return;
  const box = node.absoluteBoundingBox;
  if (!box || box.width < 240 || box.height < 200) return;
  out.push({
    node,
    id: node.id,
    name: node.name,
    width: Math.round(box.width),
    height: Math.round(box.height),
    pageName,
    score: scoreFrame(node.name, box, node),
  });
}

/**
 * Prefers frames that look like a web screen: desktop-ish width, portrait-tall
 * page height, meaningful name, and actual content inside.
 */
function scoreFrame(name: string, box: FigmaRect, node: FigmaNode): number {
  let score = 0;

  // Width band — desktop web frames cluster around 1280–1920.
  const w = box.width;
  if (w >= 1200 && w <= 2000) score += 40;
  else if (w >= 1000 && w < 1200) score += 30;
  else if (w > 2000 && w <= 2600) score += 20;
  else if (w >= 700 && w < 1000) score += 12;
  else score += 4;

  // Pages are taller than they are wide, or at least not a tiny tile.
  if (box.height >= box.width * 0.6) score += 12;
  if (box.height >= 800) score += 8;

  const childCount = countDescendants(node, 0, 3);
  score += Math.min(25, childCount * 0.6);

  if (POSITIVE_NAME_HINTS.test(name)) score += 15;
  if (NEGATIVE_NAME_HINTS.test(name)) score -= 25;

  return score;
}

function countDescendants(node: FigmaNode, depth: number, maxDepth: number): number {
  if (depth >= maxDepth || !node.children) return 0;
  let n = node.children.length;
  for (const child of node.children) n += countDescendants(child, depth + 1, maxDepth);
  return n;
}

export function selectRootFrame(document: FigmaNode): FrameCandidate | null {
  const candidates = collectFrameCandidates(document);
  return candidates[0] ?? null;
}

/** Depth-first lookup by node id, used when a URL pins a nested layer. */
export function findNodeById(root: FigmaNode, id: string): FigmaNode | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const hit = findNodeById(child, id);
    if (hit) return hit;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*                            Property extraction                             */
/* -------------------------------------------------------------------------- */

export function visiblePaints(paints: FigmaPaint[] | undefined): FigmaPaint[] {
  if (!paints) return [];
  return paints.filter((p) => p.visible !== false && (p.opacity ?? 1) > 0.01);
}

/**
 * Resolves a paint list to a single CSS color. Solid fills map directly;
 * gradients collapse to their midpoint stop so color checks still say something
 * useful instead of silently skipping.
 */
export function paintsToColor(paints: FigmaPaint[] | undefined): { css: string; rgba: Rgba; approximate: boolean } | null {
  const visible = visiblePaints(paints);
  if (visible.length === 0) return null;

  // Topmost paint wins, matching Figma's render order (last = on top).
  const paint = visible[visible.length - 1];

  if (paint.type === 'SOLID' && paint.color) {
    const rgba = figmaColorToRgba(paint.color, paint.opacity ?? 1);
    return { css: formatRgba(rgba), rgba, approximate: false };
  }

  if (paint.gradientStops?.length) {
    const stops = paint.gradientStops;
    const mid = stops[Math.floor(stops.length / 2)];
    const rgba = figmaColorToRgba(mid.color, paint.opacity ?? 1);
    return { css: formatRgba(rgba), rgba, approximate: true };
  }

  return null;
}

export function hasImageFill(node: FigmaNode): boolean {
  return visiblePaints(node.fills).some((p) => p.type === 'IMAGE');
}

export function extractCornerRadius(node: FigmaNode): number | undefined {
  if (typeof node.cornerRadius === 'number') return node.cornerRadius;
  const radii = node.rectangleCornerRadii;
  if (radii && radii.length === 4) {
    // The DOM side reports border-top-left-radius; use the same corner here.
    return radii[0];
  }
  return undefined;
}

export function extractLineHeight(node: FigmaNode): number | undefined {
  const style = node.style;
  if (!style) return undefined;
  if (typeof style.lineHeightPx === 'number' && style.lineHeightPx > 0) return style.lineHeightPx;
  if (typeof style.lineHeightPercentFontSize === 'number' && style.fontSize) {
    return (style.lineHeightPercentFontSize / 100) * style.fontSize;
  }
  return undefined;
}

export function mapTextAlign(align: string | undefined): 'left' | 'right' | 'center' | 'justify' | undefined {
  switch (align) {
    case 'LEFT':
      return 'left';
    case 'RIGHT':
      return 'right';
    case 'CENTER':
      return 'center';
    case 'JUSTIFIED':
      return 'justify';
    default:
      return undefined;
  }
}
