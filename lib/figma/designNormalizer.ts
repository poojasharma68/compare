import type {
  DesignNode,
  DesignNodeKind,
  DesignTree,
  FigmaNode,
  FigmaRect,
  SizingMode,
} from '@/lib/types/figma';
import {
  extractCornerRadius,
  extractLineHeight,
  hasImageFill,
  mapTextAlign,
  paintsToColor,
} from './figmaParser';
import { truncate } from '@/lib/utils/text';

const MAX_NODES = 4000;
const MAX_DEPTH = 16;
const MIN_DIMENSION = 2;

const TYPE_MAP: Record<string, DesignNodeKind> = {
  FRAME: 'FRAME',
  COMPONENT: 'COMPONENT',
  COMPONENT_SET: 'COMPONENT',
  INSTANCE: 'INSTANCE',
  TEXT: 'TEXT',
  RECTANGLE: 'RECTANGLE',
  GROUP: 'GROUP',
  VECTOR: 'VECTOR',
  ELLIPSE: 'RECTANGLE',
  LINE: 'VECTOR',
  POLYGON: 'VECTOR',
  STAR: 'VECTOR',
  BOOLEAN_OPERATION: 'VECTOR',
  SECTION: 'FRAME',
};

const DECORATIVE_NAME = /\b(icon|vector|divider|line|shadow|blur|bg|background|overlay|mask|decor|ornament|pattern|gradient|noise)\b/i;

export interface NormalizeOptions {
  maxNodes?: number;
  maxDepth?: number;
}

/**
 * Flattens a Figma subtree into a frame-relative, CSS-flavoured node list.
 * Coordinates become relative to the root frame so they can be scaled onto a
 * browser viewport without carrying Figma's global canvas offsets around.
 */
export function buildDesignTree(
  root: FigmaNode,
  meta: { fileKey: string; fileName: string; availableFrames: DesignTree['availableFrames'] },
  options: NormalizeOptions = {},
): DesignTree {
  const maxNodes = options.maxNodes ?? MAX_NODES;
  const maxDepth = options.maxDepth ?? MAX_DEPTH;

  const rootBox: FigmaRect = root.absoluteBoundingBox ?? { x: 0, y: 0, width: 1440, height: 900 };
  const nodes: DesignNode[] = [];
  const rootArea = Math.max(1, rootBox.width * rootBox.height);

  const walk = (
    node: FigmaNode,
    parentId: string | null,
    depth: number,
    path: string,
    inheritedOpacity: number,
  ): DesignNode | null => {
    if (nodes.length >= maxNodes) return null;
    if (node.visible === false) return null;

    const box = node.absoluteBoundingBox;
    if (!box || box.width < MIN_DIMENSION || box.height < MIN_DIMENSION) return null;

    const ownOpacity = clamp01(node.opacity ?? 1);
    const opacity = clamp01(ownOpacity * inheritedOpacity);
    if (opacity < 0.02) return null;

    const kind = resolveKind(node);
    const isImage = kind === 'IMAGE' || hasImageFill(node);

    const design: DesignNode = {
      id: node.id,
      name: node.name || node.type,
      type: isImage && kind !== 'TEXT' ? 'IMAGE' : kind,
      figmaType: node.type,
      path,
      depth,
      parentId,
      childIds: [],
      x: round(box.x - rootBox.x),
      y: round(box.y - rootBox.y),
      width: round(box.width),
      height: round(box.height),
      opacity: round(opacity, 3),
      ownOpacity: round(ownOpacity, 3),
      visible: true,
      widthSizing: resolveSizing(node, 'horizontal'),
      heightSizing: resolveSizing(node, 'vertical'),
      isImage,
      significance: 0,
    };

    if (node.type === 'TEXT' && node.characters) {
      design.text = truncate(node.characters.replace(/\s+/g, ' ').trim(), 300);
      const style = node.style ?? {};
      design.typography = {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: extractLineHeight(node),
        letterSpacing: typeof style.letterSpacing === 'number' ? style.letterSpacing : undefined,
        textAlign: mapTextAlign(style.textAlignHorizontal),
        textTransform: style.textCase,
        italic: style.italic,
      };
    }

    const fill = paintsToColor(node.fills);
    if (fill) {
      // On TEXT a fill is the glyph color; everywhere else it is the surface.
      if (node.type === 'TEXT') design.color = fill.css;
      else design.backgroundColor = fill.css;
    }
    if (!design.backgroundColor && node.backgroundColor) {
      const bg = paintsToColor(node.background);
      if (bg) design.backgroundColor = bg.css;
    }

    const stroke = paintsToColor(node.strokes);
    if (stroke || (node.strokeWeight ?? 0) > 0) {
      design.border = {
        width: node.strokeWeight ?? undefined,
        color: stroke?.css,
      };
    }

    const radius = extractCornerRadius(node);
    if (typeof radius === 'number') design.borderRadius = round(radius, 2);

    if (node.layoutMode && node.layoutMode !== 'NONE') {
      design.layout = {
        direction: node.layoutMode === 'HORIZONTAL' ? 'row' : 'column',
        gap: node.itemSpacing,
        paddingTop: node.paddingTop,
        paddingRight: node.paddingRight,
        paddingBottom: node.paddingBottom,
        paddingLeft: node.paddingLeft,
        justify: node.primaryAxisAlignItems,
        align: node.counterAxisAlignItems,
      };
    }

    design.significance = scoreSignificance(design, node, rootArea);
    nodes.push(design);

    // Vector-heavy subtrees (icons, illustrations) add noise without adding
    // testable structure, so stop descending into them.
    const descend = depth < maxDepth && kind !== 'VECTOR' && !(isImage && kind !== 'FRAME');
    if (descend) {
      const children = node.children ?? [];
      children.forEach((child, i) => {
        const result = walk(child, design.id, depth + 1, path ? `${path}.${i}` : String(i), opacity);
        if (result) design.childIds.push(result.id);
      });
    }

    return design;
  };

  walk(root, null, 0, '0', 1);

  return {
    fileKey: meta.fileKey,
    fileName: meta.fileName,
    rootId: root.id,
    rootName: root.name || 'Frame',
    rootWidth: round(rootBox.width),
    rootHeight: round(rootBox.height),
    nodes,
    availableFrames: meta.availableFrames,
  };
}

/**
 * Resolves Figma's Fixed / Hug / Fill for one axis.
 *
 * Reads the modern `layoutSizing*` fields first, then falls back to the legacy
 * auto-layout sizing modes and to `textAutoResize` for text. A dimension that
 * hugs its content is not a specification a developer can implement — it is
 * whatever the copy happens to produce — so downstream checks skip it.
 */
function resolveSizing(node: FigmaNode, axis: 'horizontal' | 'vertical'): SizingMode {
  const modern = axis === 'horizontal' ? node.layoutSizingHorizontal : node.layoutSizingVertical;
  if (modern === 'FIXED') return 'fixed';
  if (modern === 'HUG') return 'hug';
  if (modern === 'FILL') return 'fill';

  if (node.type === 'TEXT') {
    switch (node.style?.textAutoResize) {
      case 'WIDTH_AND_HEIGHT':
        return 'hug';
      case 'HEIGHT':
        // The box hugs vertically while its width is pinned.
        return axis === 'vertical' ? 'hug' : 'fixed';
      case 'NONE':
      case 'TRUNCATE':
        return 'fixed';
      default:
        // Figma omits textAutoResize on older files; height is content-driven
        // far more often than not, so treat it as hugging rather than invent a
        // specification that was never made.
        return axis === 'vertical' ? 'hug' : 'unknown';
    }
  }

  if (node.layoutMode && node.layoutMode !== 'NONE') {
    const isPrimaryAxis =
      (node.layoutMode === 'HORIZONTAL' && axis === 'horizontal') ||
      (node.layoutMode === 'VERTICAL' && axis === 'vertical');
    const mode = isPrimaryAxis ? node.primaryAxisSizingMode : node.counterAxisSizingMode;
    if (mode === 'AUTO') return 'hug';
    if (mode === 'FIXED') return 'fixed';
  }

  return 'unknown';
}

function resolveKind(node: FigmaNode): DesignNodeKind {
  return TYPE_MAP[node.type] ?? 'OTHER';
}

/**
 * How much we care that this node exists in the DOM. Drives which nodes are
 * matched, which are allowed to be missing, and how tests are ranked.
 */
function scoreSignificance(design: DesignNode, node: FigmaNode, rootArea: number): number {
  let score: number;
  switch (design.type) {
    case 'TEXT':
      score = design.text && design.text.length > 0 ? 0.82 : 0.4;
      break;
    case 'IMAGE':
      score = 0.72;
      break;
    case 'INSTANCE':
    case 'COMPONENT':
      score = 0.7;
      break;
    case 'FRAME':
      score = 0.6;
      break;
    case 'RECTANGLE':
      score = 0.45;
      break;
    case 'GROUP':
      score = 0.34;
      break;
    case 'VECTOR':
      score = 0.18;
      break;
    default:
      score = 0.3;
  }

  // Area relative to the frame: bigger blocks matter more, but with a ceiling
  // so a full-bleed background does not dominate.
  const area = design.width * design.height;
  const areaRatio = Math.min(0.4, area / rootArea);
  score += areaRatio * 0.6;

  if (design.width < 10 || design.height < 10) score -= 0.35;
  if (design.width < 24 && design.height < 24) score -= 0.2;

  // Deeply nested nodes are usually implementation detail inside a component.
  score -= Math.max(0, design.depth - 5) * 0.035;

  if (DECORATIVE_NAME.test(design.name)) score -= 0.22;
  if (design.text && design.text.length >= 3) score += 0.1;
  if (node.layoutMode && node.layoutMode !== 'NONE') score += 0.06;

  return clamp01(round(score, 3));
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function round(n: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
