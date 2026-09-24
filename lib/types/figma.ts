/**
 * Figma REST API shapes (only the subset UIX-Ray reads) plus the normalized
 * design tree every downstream engine consumes.
 */

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaPaint {
  type: string; // SOLID | GRADIENT_LINEAR | IMAGE | ...
  visible?: boolean;
  opacity?: number;
  color?: FigmaColor;
  gradientStops?: Array<{ color: FigmaColor; position: number }>;
  imageRef?: string;
  scaleMode?: string;
}

export interface FigmaTypeStyle {
  fontFamily?: string;
  fontPostScriptName?: string | null;
  fontWeight?: number;
  fontSize?: number;
  italic?: boolean;
  letterSpacing?: number;
  lineHeightPx?: number;
  lineHeightPercent?: number;
  lineHeightPercentFontSize?: number;
  lineHeightUnit?: string;
  textAlignHorizontal?: 'LEFT' | 'RIGHT' | 'CENTER' | 'JUSTIFIED';
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM';
  textCase?: string;
  textDecoration?: string;
  /** NONE | HEIGHT | WIDTH_AND_HEIGHT | TRUNCATE — whether the box hugs copy. */
  textAutoResize?: string;
}

export interface FigmaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A raw node as returned by the Figma REST API. */
export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  absoluteBoundingBox?: FigmaRect | null;
  absoluteRenderBounds?: FigmaRect | null;
  constraints?: { vertical?: string; horizontal?: string };
  clipsContent?: boolean;
  background?: FigmaPaint[];
  backgroundColor?: FigmaColor;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  strokeAlign?: string;
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  characters?: string;
  style?: FigmaTypeStyle;
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<string, FigmaTypeStyle>;
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  layoutWrap?: string;
  itemSpacing?: number;
  counterAxisSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  layoutGrow?: number;
  layoutAlign?: string;
  /** Modern per-axis sizing: FIXED | HUG | FILL. */
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  /** Legacy auto-layout sizing: FIXED | AUTO, relative to layoutMode. */
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  effects?: Array<Record<string, unknown>>;
  componentId?: string;
  children?: FigmaNode[];
}

export interface FigmaFileResponse {
  name: string;
  lastModified?: string;
  version?: string;
  thumbnailUrl?: string;
  document: FigmaNode;
  components?: Record<string, { name?: string; description?: string }>;
}

export interface FigmaNodesResponse {
  name: string;
  nodes: Record<string, { document: FigmaNode; components?: Record<string, unknown> } | null>;
}

/** Parsed pieces of a Figma URL. */
export interface FigmaUrlInfo {
  fileKey: string;
  /** API-form node id (`1:23`), if the URL pinned one via `?node-id=`. */
  nodeId: string | null;
  fileName: string | null;
  raw: string;
}

/* -------------------------------------------------------------------------- */
/*                            Normalized design tree                          */
/* -------------------------------------------------------------------------- */

export type DesignNodeKind =
  | 'FRAME'
  | 'COMPONENT'
  | 'INSTANCE'
  | 'TEXT'
  | 'RECTANGLE'
  | 'IMAGE'
  | 'GROUP'
  | 'VECTOR'
  | 'OTHER';

export interface DesignTypography {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: 'left' | 'right' | 'center' | 'justify';
  textTransform?: string;
  italic?: boolean;
}

export interface DesignBorder {
  width?: number;
  color?: string;
}

export interface DesignLayout {
  direction?: 'row' | 'column' | 'none';
  gap?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  justify?: string;
  align?: string;
}

/**
 * A Figma node flattened into a frame-relative, CSS-flavoured description.
 * Coordinates are relative to the audited root frame's top-left corner.
 */
/**
 * How a dimension was decided in the design.
 *
 * This is the distinction Figma's Dev Mode surfaces as Fixed / Hug / Fill, and
 * it is what separates a value a developer must implement from one that simply
 * falls out of the content.
 */
export type SizingMode = 'fixed' | 'hug' | 'fill' | 'unknown';

export interface DesignNode {
  id: string;
  name: string;
  type: DesignNodeKind;
  figmaType: string;
  /** Index path from the root frame, e.g. `0.2.1` — used for hierarchy signals. */
  path: string;
  depth: number;
  parentId: string | null;
  childIds: string[];

  x: number;
  y: number;
  width: number;
  height: number;

  text?: string;
  typography?: DesignTypography;

  /** Resolved primary fill as a CSS color string, when it is a flat solid. */
  color?: string;
  backgroundColor?: string;
  border?: DesignBorder;
  borderRadius?: number;
  /** Effective opacity including inherited parent opacity. */
  opacity: number;
  /** This node's own opacity only — the value CSS `opacity` maps to. */
  ownOpacity: number;
  layout?: DesignLayout;
  visible: boolean;
  /** Fixed / Hug / Fill per axis, as Dev Mode reports it. */
  widthSizing: SizingMode;
  heightSizing: SizingMode;
  /** True when the node is an image fill or an exported image placeholder. */
  isImage: boolean;
  /** Heuristic importance 0–1, used to rank what is worth testing. */
  significance: number;
}

export interface DesignTree {
  fileKey: string;
  fileName: string;
  /** The frame that was audited. */
  rootId: string;
  rootName: string;
  rootWidth: number;
  rootHeight: number;
  /** Frame-relative node list, depth-first. */
  nodes: DesignNode[];
  /** Every top-level frame we could have audited — surfaced for diagnostics. */
  availableFrames: Array<{ id: string; name: string; width: number; height: number }>;
}
