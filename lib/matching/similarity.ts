import type { DesignNode } from '@/lib/types/figma';
import type { DomElement } from '@/lib/types/dom';
import { textSimilarity, tokenize } from '@/lib/utils/text';

/** Tags that can legitimately render a Figma TEXT layer. */
const TEXT_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a', 'button', 'label', 'li',
  'strong', 'em', 'blockquote', 'td', 'th', 'figcaption', 'legend', 'summary', 'dt', 'dd',
]);

const CONTAINER_TAGS = new Set([
  'div', 'section', 'header', 'footer', 'nav', 'main', 'article', 'aside', 'form',
  'ul', 'ol', 'figure', 'picture', 'table', 'tbody', 'tr', 'fieldset', 'li', 'dl',
]);

const MEDIA_TAGS = new Set(['img', 'picture', 'svg', 'video', 'canvas', 'figure']);

const INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea']);

/** Words in a Figma layer name that imply a specific HTML element. */
const NAME_TO_TAGS: Array<{ re: RegExp; tags: string[] }> = [
  { re: /\b(h1|title|headline|heading)\b/i, tags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] },
  { re: /\b(subtitle|subhead|caption|label|eyebrow)\b/i, tags: ['p', 'span', 'h3', 'h4', 'h5', 'h6', 'label'] },
  { re: /\b(body|paragraph|description|copy|text)\b/i, tags: ['p', 'span', 'div'] },
  { re: /\b(button|btn|cta)\b/i, tags: ['button', 'a'] },
  { re: /\b(link|anchor)\b/i, tags: ['a'] },
  { re: /\b(nav|navbar|navigation|menu)\b/i, tags: ['nav', 'ul', 'header'] },
  { re: /\b(header|topbar|masthead)\b/i, tags: ['header', 'nav'] },
  { re: /\b(footer)\b/i, tags: ['footer'] },
  { re: /\b(image|img|photo|picture|avatar|thumbnail|illustration)\b/i, tags: ['img', 'picture', 'svg', 'figure'] },
  { re: /\b(input|field|textbox|search)\b/i, tags: ['input', 'textarea', 'form'] },
  { re: /\b(card|tile|item|panel|box)\b/i, tags: ['div', 'article', 'li', 'section'] },
  { re: /\b(list|grid|row|column|stack|container|wrapper|group)\b/i, tags: ['div', 'ul', 'ol', 'section'] },
  { re: /\b(section|block|hero|banner|feature)\b/i, tags: ['section', 'div', 'header'] },
  { re: /\b(icon|logo)\b/i, tags: ['svg', 'img', 'i', 'span'] },
];

/** Semantic tokens implied by a DOM tag, used for name matching. */
const TAG_TOKENS: Record<string, string[]> = {
  h1: ['heading', 'title', 'headline'],
  h2: ['heading', 'title', 'subtitle'],
  h3: ['heading', 'subtitle'],
  h4: ['heading', 'subtitle'],
  h5: ['heading'],
  h6: ['heading'],
  p: ['text', 'body', 'paragraph', 'description'],
  a: ['link', 'button', 'cta'],
  button: ['button', 'cta', 'action'],
  img: ['image', 'photo', 'picture'],
  svg: ['icon', 'logo', 'vector'],
  nav: ['nav', 'navigation', 'menu'],
  header: ['header', 'nav', 'top'],
  footer: ['footer', 'bottom'],
  main: ['main', 'content'],
  section: ['section', 'block'],
  article: ['card', 'article', 'item'],
  li: ['item', 'list'],
  ul: ['list', 'menu'],
  ol: ['list'],
  input: ['input', 'field'],
  form: ['form'],
  label: ['label'],
  figure: ['image', 'figure'],
};

export interface ScaleContext {
  /** designPx × scale = expected CSS px. */
  scale: number;
  viewportWidth: number;
  /** Height of the mapped design region in CSS px. */
  designHeightPx: number;
  /**
   * Design coordinates → expected page coordinates.
   *
   * Starts as plain scaling and is replaced with a fitted mapping once enough
   * confident text matches exist. Over a long page the two coordinate systems
   * drift apart cumulatively — an extra paragraph near the top pushes
   * everything below it — so without this, nothing past the first screenful
   * lands close enough to its expected position to be considered at all.
   */
  mapX: (designX: number) => number;
  mapY: (designY: number) => number;
}

/** Plain scaling, used before any registration has been established. */
export function identityMapping(scale: number): Pick<ScaleContext, 'mapX' | 'mapY'> {
  return { mapX: (x) => x * scale, mapY: (y) => y * scale };
}

/** 0–1 type compatibility between a design node and a DOM element. */
export function typeScore(node: DesignNode, el: DomElement): number {
  const tag = el.tag;

  switch (node.type) {
    case 'TEXT': {
      if (TEXT_TAGS.has(tag)) return 1;
      if (tag === 'div' || tag === 'input' || tag === 'textarea') return 0.55;
      if (MEDIA_TAGS.has(tag)) return 0.05;
      return 0.25;
    }
    case 'IMAGE': {
      if (MEDIA_TAGS.has(tag)) return 1;
      if (el.styles.backgroundImage) return 0.8;
      if (CONTAINER_TAGS.has(tag)) return 0.35;
      return 0.15;
    }
    case 'INSTANCE':
    case 'COMPONENT': {
      // Components are usually buttons, cards or nav items.
      if (INTERACTIVE_TAGS.has(tag)) return 0.9;
      if (CONTAINER_TAGS.has(tag)) return 0.85;
      if (TEXT_TAGS.has(tag)) return 0.6;
      if (MEDIA_TAGS.has(tag)) return 0.6;
      return 0.4;
    }
    case 'FRAME':
    case 'GROUP': {
      if (CONTAINER_TAGS.has(tag)) return 0.95;
      if (INTERACTIVE_TAGS.has(tag)) return 0.7;
      if (TEXT_TAGS.has(tag)) return 0.35;
      return 0.45;
    }
    case 'RECTANGLE': {
      if (el.styles.backgroundImage) return 0.75;
      if (CONTAINER_TAGS.has(tag)) return 0.75;
      if (tag === 'span' || tag === 'hr') return 0.6;
      if (MEDIA_TAGS.has(tag)) return 0.6;
      return 0.4;
    }
    default:
      return 0.4;
  }
}

/**
 * 0–1 geometric agreement. Horizontal placement and size dominate: vertical
 * offsets drift legitimately as content length differs between design and
 * implementation, so Y is weighted lightly and forgivingly.
 */
export function geometryScore(node: DesignNode, el: DomElement, ctx: ScaleContext): number {
  const expX = ctx.mapX(node.x);
  const expY = ctx.mapY(node.y);
  const expW = node.width * ctx.scale;
  const expH = node.height * ctx.scale;

  const xTolerance = Math.max(60, ctx.viewportWidth * 0.3);
  const yTolerance = Math.max(300, ctx.designHeightPx * 0.25);

  const posX = clamp01(1 - Math.abs(expX - el.rect.x) / xTolerance);
  const posY = clamp01(1 - Math.abs(expY - el.rect.y) / yTolerance);

  const sizeW = ratioScore(expW, el.rect.width);
  const sizeH = ratioScore(expH, el.rect.height);

  // Centre alignment catches elements that are centred differently but
  // occupy the same slot in the layout.
  const expCenter = expX + expW / 2;
  const domCenter = el.rect.x + el.rect.width / 2;
  const center = clamp01(1 - Math.abs(expCenter - domCenter) / xTolerance);

  return clamp01(0.26 * posX + 0.14 * posY + 0.26 * sizeW + 0.16 * sizeH + 0.18 * center);
}

/** Size agreement that tolerates proportional differences rather than absolute. */
function ratioScore(expected: number, actual: number): number {
  if (expected <= 0 && actual <= 0) return 1;
  const larger = Math.max(expected, actual, 1);
  const smaller = Math.min(expected, actual);
  if (smaller <= 0) return 0;
  return clamp01(smaller / larger);
}

/** 0–1 agreement between a Figma layer name and a DOM element's identity. */
export function nameScore(node: DesignNode, el: DomElement): number {
  const nameTokens = tokenize(node.name);
  if (nameTokens.length === 0) return 0.3;

  const domTokens = new Set<string>();
  domTokens.add(el.tag);
  for (const token of TAG_TOKENS[el.tag] ?? []) domTokens.add(token);
  if (el.role) for (const token of tokenize(el.role)) domTokens.add(token);
  if (el.id) for (const token of splitIdentifier(el.id)) domTokens.add(token);
  for (const cls of el.classList) {
    for (const token of splitIdentifier(cls)) domTokens.add(token);
  }

  let hits = 0;
  for (const token of nameTokens) {
    if (token.length < 3) continue;
    if (domTokens.has(token)) hits++;
    else if (token.endsWith('s') && domTokens.has(token.slice(0, -1))) hits++;
  }
  const overlap = nameTokens.length > 0 ? hits / nameTokens.length : 0;

  // A name that implies an element type agrees with the actual tag.
  let implied = 0;
  for (const rule of NAME_TO_TAGS) {
    if (rule.re.test(node.name)) {
      implied = rule.tags.includes(el.tag) ? 1 : Math.max(implied, 0);
      if (implied === 1) break;
    }
  }

  return clamp01(Math.max(overlap, implied * 0.85, 0.15));
}

function splitIdentifier(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 2 && !/^\d+$/.test(s));
}

/**
 * Text agreement. Compares against the element's own text first (the precise
 * signal) and falls back to full textContent for wrapper elements.
 */
export function textScore(node: DesignNode, el: DomElement): number {
  if (!node.text) return 0;
  const own = el.ownText ? textSimilarity(node.text, el.ownText) : 0;
  if (own >= 0.92) return own;
  const full = el.text ? textSimilarity(node.text, el.text) : 0;
  // Wrapper matches are real but weaker than an exact leaf match.
  return Math.max(own, full * 0.88);
}

export function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
