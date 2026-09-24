/** Shapes produced by the in-page extraction script and the page analyzer. */

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ElementStyles {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number | null;
  letterSpacing: number;
  textAlign: string;
  textTransform: string;
  color: string;
  backgroundColor: string;
  backgroundImage: string;
  borderRadius: number;
  borderTopWidth: number;
  borderRightWidth: number;
  borderBottomWidth: number;
  borderLeftWidth: number;
  borderColor: string;
  borderStyle: string;
  opacity: number;
  display: string;
  visibility: string;
  position: string;
  overflowX: string;
  overflowY: string;
  textOverflow: string;
  whiteSpace: string;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  gap: number | null;
  flexDirection: string;
  flexWrap: string;
  gridTemplateColumns: string;
  zIndex: string;
  objectFit: string;
  maxWidth: string;
  minWidth: string;
  boxSizing: string;
  transform: string;
  float: string;
}

/** One meaningful element captured from the live page. */
export interface DomElement {
  /** Stable index within this snapshot; used as the identity for matching. */
  index: number;
  parentIndex: number | null;
  childIndexes: number[];
  depth: number;
  /** Index path from body, e.g. `0.3.2`. */
  path: string;

  tag: string;
  id: string | null;
  classList: string[];
  role: string | null;
  ariaLabel: string | null;
  /** Unique-ish CSS selector for the element. */
  selector: string;
  /** Short human label, e.g. `h1.hero-title`. */
  label: string;

  /** Text owned by this element (direct text nodes), trimmed + capped. */
  ownText: string;
  /** Full textContent, trimmed + capped. Used for container-level matching. */
  text: string;

  rect: ElementRect;
  styles: ElementStyles;

  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;

  /** Number of rendered line boxes; 0 when the element owns no text. */
  lineCount: number;

  isImage: boolean;
  /** `HTMLImageElement.complete` — false simply means "still loading". */
  imageComplete?: boolean;
  naturalWidth?: number;
  naturalHeight?: number;
  src?: string;
  alt?: string;

  /** True when this element itself clips overflow on either axis. */
  clipsOverflow: boolean;
  /** True when some ancestor clips overflow — suppresses false overflow hits. */
  clippedByAncestor: boolean;
  /** True when the element or an ancestor is absolutely/fixed positioned. */
  positionedAncestor: boolean;
  /** True when an inline style pins an explicit px width. */
  hasInlineFixedWidth: boolean;

  isInteractive: boolean;
  /** Heuristic importance 0–1 used to prioritise tests and cap snapshot size. */
  significance: number;
}

export interface PageMetrics {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  bodyScrollWidth: number;
  devicePixelRatio: number;
  documentTitle: string;
  /** Elements whose right edge sits past the viewport, widest first. */
  overflowCandidates: Array<{ index: number; overhang: number }>;
}

export interface ViewportSpec {
  id: string;
  label: string;
  width: number;
  height: number;
  group: 'mobile' | 'tablet' | 'desktop';
  isMobile: boolean;
  deviceScaleFactor: number;
  /** Engine this pass ran in. Absent on the preset matrix itself. */
  browser?: 'chromium' | 'firefox' | 'webkit';
  /** The browser-independent viewport id/label, set on multi-browser passes. */
  baseId?: string;
  baseLabel?: string;
  /** True for a dimension the user entered rather than a preset. */
  custom?: boolean;
}

/** Everything captured for one viewport in one page load. */
export interface PageSnapshot {
  viewport: ViewportSpec;
  url: string;
  finalUrl: string;
  elements: DomElement[];
  metrics: PageMetrics;
  /** Non-fatal problems observed while loading (timeouts, page JS errors). */
  warnings: string[];
  consoleErrors: string[];
  loadMs: number;
  screenshot?: EvidenceShot;
}

/** A stored screenshot plus the CSS-pixel region it covers. */
export interface EvidenceShot {
  id: string;
  /** CSS-pixel width/height of the captured region. */
  width: number;
  height: number;
}
