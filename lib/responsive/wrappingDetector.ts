import type { DomElement } from '@/lib/types/dom';
import type { ResponsiveTestResult } from '@/lib/types/tests';
import { buildResponsiveTest, parentOf, px, round, type ResponsiveContext } from './context';

const MAX_REPORTED = 6;
/** A token longer than this is a candidate for an unbreakable-word overflow. */
const LONG_WORD = 12;

/**
 * Text wrapping problems, judged against the widest viewport.
 *
 * Reflowing onto more lines at a narrower viewport is exactly what responsive
 * text is supposed to do, so that alone is never reported. What is reported:
 * text that grows more lines without the box growing to fit them, and single
 * unbreakable tokens that are wider than their container.
 */
export function detectWrapping(ctx: ResponsiveContext): ResponsiveTestResult[] {
  const tests: ResponsiveTestResult[] = [];
  const findings: ResponsiveTestResult[] = [];

  let checked = 0;

  for (const el of ctx.snapshot.elements) {
    if (findings.length >= MAX_REPORTED) break;
    if (!el.ownText || el.ownText.length < 3) continue;
    if (el.significance < 0.4) continue;
    checked++;

    const longWord = longestToken(el.ownText);
    const container = parentOf(el, ctx);

    // An unbreakable token wider than the box will overflow at any width.
    if (longWord.length >= LONG_WORD && el.scrollWidth > el.clientWidth + 1 && el.styles.whiteSpace !== 'nowrap') {
      findings.push(
        buildResponsiveTest(ctx, {
          category: 'Wrapping',
          check: 'wrapping.unbreakableWord',
          title: 'Unbreakable text overflows its container',
          element: el.label,
          selector: el.selector,
          expected: `Text wraps within ${px(el.clientWidth)}`,
          actual: `Content is ${px(el.scrollWidth)} wide — "${longWord}" cannot wrap`,
          difference: `${px(el.scrollWidth - el.clientWidth)} over`,
          delta: round(el.scrollWidth - el.clientWidth),
          status: 'FAIL',
          severity: 'major',
          message: `The token "${longWord}" is wider than its container and has no break opportunity. Consider \`overflow-wrap: anywhere\` or \`hyphens: auto\`.`,
          highlight: el,
        }),
      );
      continue;
    }

    // Text spilling horizontally past its own container's content box.
    if (container && !container.clipsOverflow) {
      const spill = el.rect.right - (container.rect.right - container.styles.paddingRight);
      if (spill > 4 && el.rect.width > 0) {
        findings.push(
          buildResponsiveTest(ctx, {
            category: 'Wrapping',
            check: 'wrapping.escapesContainer',
            title: 'Text extends outside its container',
            element: el.label,
            selector: el.selector,
            expected: `Stays within ${container.label}`,
            actual: `Extends ${px(spill)} past the container's content box`,
            difference: `${px(spill)} outside`,
            delta: round(spill),
            status: 'FAIL',
            severity: spill > 24 ? 'major' : 'minor',
            message: `"${el.ownText.slice(0, 60)}" renders outside ${container.label} at this viewport.`,
            highlight: el,
          }),
        );
        continue;
      }
    }

    // Cross-viewport: more lines, but the box did not grow to hold them.
    const baseline = ctx.baselineBySelector.get(el.selector);
    if (baseline && baseline.lineCount > 0 && el.lineCount > baseline.lineCount) {
      const expectedHeight = baseline.rect.height * (el.lineCount / baseline.lineCount);
      const shortfall = expectedHeight - el.rect.height;
      // Allow a generous margin: line-height and padding do not scale linearly.
      if (shortfall > Math.max(12, expectedHeight * 0.25)) {
        findings.push(
          buildResponsiveTest(ctx, {
            category: 'Wrapping',
            check: 'wrapping.heightNotAdjusted',
            title: 'Wrapped text does not fit its box',
            element: el.label,
            selector: el.selector,
            expected: `About ${px(expectedHeight)} tall for ${el.lineCount} lines`,
            actual: `${px(el.rect.height)} tall (was ${baseline.lineCount} line${
              baseline.lineCount === 1 ? '' : 's'
            } at ${ctx.baseline?.viewport.label ?? 'the reference viewport'})`,
            difference: `${px(shortfall)} short`,
            delta: round(shortfall),
            status: 'FAIL',
            severity: 'major',
            message: `This text wraps onto ${el.lineCount} lines here but its box did not grow to match — a fixed height or a clamped container is squeezing it.`,
            highlight: el,
          }),
        );
      }
    }
  }

  const clean = Math.max(0, checked - findings.length);
  if (clean > 0 || findings.length === 0) {
    tests.push(
      buildResponsiveTest(ctx, {
        category: 'Wrapping',
        check: 'wrapping.text',
        title: 'Text wraps correctly',
        element: findings.length === 0 ? 'all text elements' : `${clean} of ${checked} text elements`,
        expected: 'Text reflows within its container',
        actual:
          findings.length === 0
            ? 'No wrapping problems detected'
            : `${clean} text element${clean === 1 ? '' : 's'} reflow cleanly`,
        difference: 'none',
        status: 'PASS',
        severity: 'none',
      }),
    );
  }

  return [...tests, ...findings];
}

function longestToken(text: string): string {
  let longest = '';
  for (const token of text.split(/\s+/)) {
    if (token.length > longest.length) longest = token;
  }
  return longest;
}
