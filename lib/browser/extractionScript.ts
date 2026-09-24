import type { DomElement, PageMetrics } from '@/lib/types/dom';

export interface ExtractionConfig {
  maxElements: number;
  /** Elements smaller than this (px²) are only kept when semantically strong. */
  minArea: number;
  maxTextLength: number;
}

export interface ExtractionResult {
  elements: DomElement[];
  metrics: PageMetrics;
}

/**
 * Runs inside the page via `page.evaluate`. It must stay entirely
 * self-contained: no imports, no closure over module scope, no helpers defined
 * outside this function. Written in a deliberately plain style so no bundler
 * helper injection can leak into the serialized source.
 */
export function domExtractor(config: ExtractionConfig): ExtractionResult {
  var MAX_CANDIDATES = 9000;
  var SKIP_TAGS: Record<string, boolean> = {
    SCRIPT: true, STYLE: true, NOSCRIPT: true, META: true, LINK: true, TITLE: true,
    HEAD: true, TEMPLATE: true, BASE: true, BR: true, WBR: true, HR: true,
    PATH: true, G: true, CIRCLE: true, RECT: true, ELLIPSE: true, POLYGON: true,
    POLYLINE: true, LINE: true, DEFS: true, CLIPPATH: true, MASK: true, USE: true,
    STOP: true, LINEARGRADIENT: true, RADIALGRADIENT: true, FILTER: true,
    FEGAUSSIANBLUR: true, TSPAN: true, TEXTPATH: true, SYMBOL: true, MARKER: true,
    PATTERN: true, FOREIGNOBJECT: true, ANIMATE: true, ANIMATETRANSFORM: true,
    IFRAME: true, OBJECT: true, EMBED: true, PARAM: true, SOURCE: true, TRACK: true,
    AREA: true, MAP: true, COL: true, COLGROUP: true, OPTION: true, OPTGROUP: true,
    DATALIST: true, SLOT: true,
  };

  var PRIORITY: Record<string, number> = {
    H1: 0.95, H2: 0.9, H3: 0.85, H4: 0.78, H5: 0.72, H6: 0.7,
    BUTTON: 0.85, NAV: 0.82, HEADER: 0.82, MAIN: 0.8, IMG: 0.76, FOOTER: 0.72,
    P: 0.7, FORM: 0.7, INPUT: 0.66, TEXTAREA: 0.66, SELECT: 0.66, A: 0.64,
    SECTION: 0.6, ARTICLE: 0.6, ASIDE: 0.55, FIGURE: 0.55, VIDEO: 0.6, CANVAS: 0.5,
    BLOCKQUOTE: 0.55, TABLE: 0.6, LABEL: 0.5, UL: 0.48, OL: 0.48, LI: 0.46,
    PICTURE: 0.6, SVG: 0.42, SPAN: 0.3, DIV: 0.34, STRONG: 0.3, EM: 0.3, TD: 0.35, TH: 0.4,
  };

  var TRACKING = /(^|[-_])(gtm|ga|analytics|pixel|beacon|tracker|tracking|consent|cookiebot|onetrust|hotjar|intercom|drift|recaptcha)([-_]|$)/i;
  var SR_ONLY = /(^|[\s-_])(sr|a11y)[-_]only|visually[-_]?hidden|screen[-_]?reader|assistive[-_]?text/i;
  var MEANINGFUL_CLASS = /(card|cta|hero|btn|button|title|heading|nav|menu|banner|feature|price|product|footer|header|container|wrapper|section)/i;

  var docEl = document.documentElement;
  var viewportWidth = docEl.clientWidth;
  var viewportHeight = docEl.clientHeight;
  var viewportArea = Math.max(1, viewportWidth * viewportHeight);
  var scrollX = window.scrollX || 0;
  var scrollY = window.scrollY || 0;

  var candidateEls: Element[] = [];
  var candidateRecords: DomElement[] = [];
  var candidateParents: number[] = [];

  function num(value: string | null | undefined): number {
    if (!value) return 0;
    var n = parseFloat(value);
    return isFinite(n) ? n : 0;
  }

  function cleanText(value: string, max: number): string {
    var s = value.replace(/\s+/g, ' ').trim();
    if (s.length > max) s = s.slice(0, max - 1) + '…';
    return s;
  }

  function directText(el: Element): string {
    var out = '';
    var kids = el.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var node = kids[i];
      if (node.nodeType === 3 && node.nodeValue) out += node.nodeValue + ' ';
    }
    return cleanText(out, config.maxTextLength);
  }

  function isIdentifier(value: string): boolean {
    return /^[A-Za-z][\w-]*$/.test(value);
  }

  /** Builds a document-unique selector, stopping early at a usable id. */
  function buildSelector(el: Element): string {
    var parts: string[] = [];
    var current: Element | null = el;
    var guard = 0;
    while (current && current.nodeType === 1 && guard < 12) {
      guard++;
      var tag = current.tagName.toLowerCase();
      var id = current.getAttribute('id');
      if (id && isIdentifier(id)) {
        var unique = false;
        try {
          unique = document.querySelectorAll('#' + id).length === 1;
        } catch (e) {
          unique = false;
        }
        if (unique) {
          parts.unshift('#' + id);
          return parts.join(' > ');
        }
      }
      var parent: Element | null = current.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      var sameTag = 0;
      var position = 0;
      for (var i = 0; i < parent.children.length; i++) {
        var sibling = parent.children[i];
        if (sibling.tagName === current.tagName) {
          sameTag++;
          if (sibling === current) position = sameTag;
        }
      }
      parts.unshift(sameTag > 1 ? tag + ':nth-of-type(' + position + ')' : tag);
      if (tag === 'body' || tag === 'html') break;
      current = parent;
    }
    return parts.join(' > ');
  }

  function buildLabel(el: Element, ownText: string): string {
    var tag = el.tagName.toLowerCase();
    var id = el.getAttribute('id');
    if (id && isIdentifier(id)) return tag + '#' + id;
    var cls = el.getAttribute('class');
    if (cls) {
      var tokens = cls.split(/\s+/);
      var best = '';
      for (var i = 0; i < tokens.length; i++) {
        var token = tokens[i];
        if (token.length < 2 || token.length > 28) continue;
        if (MEANINGFUL_CLASS.test(token)) {
          best = token;
          break;
        }
        if (!best) best = token;
      }
      if (best) return tag + '.' + best;
    }
    if (ownText) return tag + ' "' + cleanText(ownText, 28) + '"';
    return tag;
  }

  function clipsAxis(value: string): boolean {
    return value === 'hidden' || value === 'clip' || value === 'auto' || value === 'scroll';
  }

  function significance(el: Element, tag: string, rect: DOMRect, ownText: string, depth: number): number {
    var score = PRIORITY[tag];
    if (score === undefined) score = 0.28;

    var area = rect.width * rect.height;
    score += Math.min(0.25, (area / viewportArea) * 0.5);

    if (ownText.length > 0) score += 0.1;
    if (ownText.length > 80) score += 0.04;
    if (rect.width < 12 || rect.height < 12) score -= 0.3;
    // Deliberately no above-the-fold bonus: when pruning has to drop elements,
    // biasing towards the first screenful would quietly reduce the audit to the
    // hero section.

    score -= Math.max(0, depth - 8) * 0.02;

    var id = el.getAttribute('id') || '';
    var cls = el.getAttribute('class') || '';
    if (TRACKING.test(id) || TRACKING.test(cls)) score -= 0.5;
    if (MEANINGFUL_CLASS.test(cls)) score += 0.08;

    return Math.max(0, Math.min(1, score));
  }

  function shouldCollect(
    el: Element,
    tag: string,
    style: CSSStyleDeclaration,
    rect: DOMRect,
    ownText: string,
    depth: number,
  ): boolean {
    var priority = PRIORITY[tag];
    if (priority !== undefined && priority >= 0.4) return true;
    if (ownText.length > 0) return true;
    if (tag === 'IMG' || tag === 'SVG' || tag === 'VIDEO' || tag === 'CANVAS') return true;

    var area = rect.width * rect.height;
    if (area < config.minArea) return false;

    // Card-like surfaces carry their own background, border or shadow.
    var bg = style.backgroundColor;
    var hasSurface =
      (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') ||
      (style.backgroundImage && style.backgroundImage !== 'none') ||
      num(style.borderTopWidth) > 0 ||
      num(style.borderLeftWidth) > 0 ||
      (style.boxShadow && style.boxShadow !== 'none');
    if (hasSurface) return true;

    // Layout containers matter: they are where responsive layouts break.
    var display = style.display;
    var isContainer =
      (display === 'flex' || display === 'grid' || display === 'inline-flex') && el.children.length >= 2;
    if (isContainer) return true;

    return depth <= 5 && area >= viewportArea * 0.05;
  }

  function visit(
    el: Element,
    rawParent: number,
    depth: number,
    clippedByAncestor: boolean,
    positionedAncestor: boolean,
  ): void {
    if (candidateRecords.length >= MAX_CANDIDATES) return;
    var tag = el.tagName ? el.tagName.toUpperCase() : '';
    if (!tag || SKIP_TAGS[tag] === true) return;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return;

    var style: CSSStyleDeclaration;
    try {
      style = window.getComputedStyle(el);
    } catch (e) {
      return;
    }
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return;
    if (num(style.opacity) < 0.05) return;

    var rect = el.getBoundingClientRect();
    // Entirely off to the left or above the document: hidden drawer, skip link.
    if (rect.right <= 0 || rect.bottom <= 0) return;

    // Screen-reader-only content is deliberately invisible to sighted users —
    // the 1px-box-with-overflow-hidden trick, a clip-path, or an sr-only class.
    // It is correct markup, and measuring it visually only produces noise.
    var srSized = (rect.width <= 1 || rect.height <= 1) && (clipsAxis(style.overflowX) || clipsAxis(style.overflowY));
    var srClipped = style.clipPath === 'inset(50%)' || (style as unknown as Record<string, string>).clip === 'rect(0px, 0px, 0px, 0px)';
    if (srSized || srClipped || SR_ONLY.test(el.getAttribute('class') || '')) return;

    var selfClips = clipsAxis(style.overflowX) || clipsAxis(style.overflowY);
    var selfPositioned = style.position === 'absolute' || style.position === 'fixed' || style.position === 'sticky';
    var childClipped = clippedByAncestor || selfClips;
    var childPositioned = positionedAncestor || selfPositioned;

    var myIndex = rawParent;

    if (rect.width >= 1 && rect.height >= 1) {
      var ownText = directText(el);
      if (shouldCollect(el, tag, style, rect, ownText, depth)) {
        var inlineStyle = el.getAttribute('style') || '';
        var lineCount = 0;
        if (ownText.length > 0 && el.children.length === 0) {
          try {
            var range = document.createRange();
            range.selectNodeContents(el);
            lineCount = range.getClientRects().length;
          } catch (e) {
            lineCount = 0;
          }
        }

        var htmlEl = el as HTMLElement;
        var record: DomElement = {
          index: candidateRecords.length,
          parentIndex: rawParent >= 0 ? rawParent : null,
          childIndexes: [],
          depth: depth,
          path: '',
          tag: tag.toLowerCase(),
          id: el.getAttribute('id'),
          classList: (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 8),
          role: el.getAttribute('role'),
          ariaLabel: el.getAttribute('aria-label'),
          selector: buildSelector(el),
          label: buildLabel(el, ownText),
          ownText: ownText,
          text: cleanText(el.textContent || '', config.maxTextLength),
          rect: {
            x: rect.left + scrollX,
            y: rect.top + scrollY,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
          },
          styles: {
            fontFamily: style.fontFamily,
            fontSize: num(style.fontSize),
            fontWeight: num(style.fontWeight) || (style.fontWeight === 'bold' ? 700 : 400),
            lineHeight: style.lineHeight === 'normal' ? null : num(style.lineHeight),
            letterSpacing: style.letterSpacing === 'normal' ? 0 : num(style.letterSpacing),
            textAlign: style.textAlign,
            textTransform: style.textTransform,
            color: style.color,
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage === 'none' ? '' : cleanText(style.backgroundImage, 160),
            borderRadius: num(style.borderTopLeftRadius),
            borderTopWidth: num(style.borderTopWidth),
            borderRightWidth: num(style.borderRightWidth),
            borderBottomWidth: num(style.borderBottomWidth),
            borderLeftWidth: num(style.borderLeftWidth),
            borderColor: style.borderTopColor,
            borderStyle: style.borderTopStyle,
            opacity: num(style.opacity),
            display: style.display,
            visibility: style.visibility,
            position: style.position,
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            textOverflow: style.textOverflow,
            whiteSpace: style.whiteSpace,
            paddingTop: num(style.paddingTop),
            paddingRight: num(style.paddingRight),
            paddingBottom: num(style.paddingBottom),
            paddingLeft: num(style.paddingLeft),
            marginTop: num(style.marginTop),
            marginRight: num(style.marginRight),
            marginBottom: num(style.marginBottom),
            marginLeft: num(style.marginLeft),
            gap: !style.gap || style.gap === 'normal' ? null : num(style.gap),
            flexDirection: style.flexDirection,
            flexWrap: style.flexWrap,
            gridTemplateColumns: cleanText(style.gridTemplateColumns || '', 200),
            zIndex: style.zIndex,
            objectFit: style.objectFit,
            maxWidth: style.maxWidth,
            minWidth: style.minWidth,
            boxSizing: style.boxSizing,
            transform: style.transform === 'none' ? '' : cleanText(style.transform, 80),
            float: style.float || 'none',
          },
          scrollWidth: htmlEl.scrollWidth,
          scrollHeight: htmlEl.scrollHeight,
          clientWidth: htmlEl.clientWidth,
          clientHeight: htmlEl.clientHeight,
          lineCount: lineCount,
          isImage: tag === 'IMG' || tag === 'PICTURE' || tag === 'SVG',
          clipsOverflow: selfClips,
          clippedByAncestor: clippedByAncestor,
          positionedAncestor: childPositioned,
          hasInlineFixedWidth: /(^|;)\s*width\s*:\s*\d+px/i.test(inlineStyle),
          isInteractive:
            tag === 'BUTTON' ||
            tag === 'A' ||
            tag === 'INPUT' ||
            tag === 'SELECT' ||
            tag === 'TEXTAREA' ||
            el.getAttribute('role') === 'button' ||
            el.getAttribute('tabindex') !== null,
          significance: significance(el, tag, rect, ownText, depth),
        };

        if (tag === 'IMG') {
          var img = el as HTMLImageElement;
          record.imageComplete = img.complete;
          record.naturalWidth = img.naturalWidth;
          record.naturalHeight = img.naturalHeight;
          record.src = cleanText(img.currentSrc || img.src || '', 200);
          record.alt = cleanText(img.alt || '', 120);
        }

        myIndex = candidateRecords.length;
        candidateEls.push(el);
        candidateRecords.push(record);
        candidateParents.push(rawParent);
      }
    }

    var children = el.children;
    for (var i = 0; i < children.length; i++) {
      visit(children[i], myIndex, depth + 1, childClipped, childPositioned);
    }
  }

  if (document.body) visit(document.body, -1, 0, false, false);

  /* ---------------------- prune to the most useful set ---------------------- */

  var total = candidateRecords.length;
  var keep: boolean[] = new Array(total);
  if (total <= config.maxElements) {
    for (var k = 0; k < total; k++) keep[k] = true;
  } else {
    var order: number[] = [];
    for (var o = 0; o < total; o++) {
      order.push(o);
      keep[o] = false;
    }
    order.sort(function (a, b) {
      return candidateRecords[b].significance - candidateRecords[a].significance;
    });
    for (var s = 0; s < config.maxElements; s++) keep[order[s]] = true;
  }

  var remap: number[] = new Array(total);
  var elements: DomElement[] = [];
  for (var c = 0; c < total; c++) {
    if (!keep[c]) {
      remap[c] = -1;
      continue;
    }
    remap[c] = elements.length;
    elements.push(candidateRecords[c]);
  }

  // Re-link survivors to their nearest surviving ancestor so hierarchy signals
  // stay meaningful even after pruning.
  var childCounters: Record<string, number> = {};
  for (var e = 0; e < total; e++) {
    if (remap[e] < 0) continue;
    var rec = candidateRecords[e];
    var ancestor = candidateParents[e];
    while (ancestor >= 0 && remap[ancestor] < 0) ancestor = candidateParents[ancestor];
    var parentIdx = ancestor >= 0 ? remap[ancestor] : -1;
    rec.index = remap[e];
    rec.parentIndex = parentIdx >= 0 ? parentIdx : null;
    var counterKey = String(parentIdx);
    if (childCounters[counterKey] === undefined) childCounters[counterKey] = 0;
    var childOrder = childCounters[counterKey];
    childCounters[counterKey] = childOrder + 1;
    rec.path = parentIdx >= 0 ? elements[parentIdx].path + '.' + childOrder : String(childOrder);
    if (parentIdx >= 0) elements[parentIdx].childIndexes.push(remap[e]);
  }

  /* ------------------------------- metrics -------------------------------- */

  var overflowCandidates: Array<{ index: number; overhang: number }> = [];
  for (var m = 0; m < elements.length; m++) {
    var r = elements[m].rect;
    var overhang = Math.max(r.right - viewportWidth, -r.left);
    if (overhang > 1 && !elements[m].clippedByAncestor) {
      overflowCandidates.push({ index: m, overhang: Math.round(overhang * 100) / 100 });
    }
  }
  overflowCandidates.sort(function (a, b) {
    return b.overhang - a.overhang;
  });

  var metrics: PageMetrics = {
    scrollWidth: docEl.scrollWidth,
    clientWidth: docEl.clientWidth,
    scrollHeight: docEl.scrollHeight,
    clientHeight: docEl.clientHeight,
    bodyScrollWidth: document.body ? document.body.scrollWidth : docEl.scrollWidth,
    devicePixelRatio: window.devicePixelRatio || 1,
    documentTitle: document.title || '',
    overflowCandidates: overflowCandidates.slice(0, 40),
  };

  return { elements: elements, metrics: metrics };
}
