import type { DomElement } from '@/lib/types/dom';
import type { ResponsiveTestResult } from '@/lib/types/tests';
import { buildResponsiveTest, px, round, type ResponsiveContext } from './context';

const MAX_REPORTED = 8;

/**
 * Finds text that is physically cut off by its container.
 *
 * The distinction that matters: an ellipsis is a designed truncation, while
 * `overflow: hidden` with no ellipsis silently destroys content. The first is a
 * warning, the second is a failure.
 */
export function detectClipping(ctx: ResponsiveContext): ResponsiveTestResult[] {
  const tol = ctx.tolerances.CLIPPING_TOLERANCE;
  const findings: Array<{ el: DomElement; axis: 'horizontal' | 'vertical'; amount: number; ellipsis: boolean }> = [];

  let checked = 0;

  for (const el of ctx.snapshot.elements) {
    if (!el.ownText || el.ownText.length < 2) continue;
    if (el.clientWidth <= 0 || el.clientHeight <= 0) continue;
    checked++;

    const ellipsis = el.styles.textOverflow === 'ellipsis';

    const xClips = el.styles.overflowX === 'hidden' || el.styles.overflowX === 'clip';
    const xOverflow = el.scrollWidth - el.clientWidth;
    if (xClips && xOverflow > tol) {
      findings.push({ el, axis: 'horizontal', amount: xOverflow, ellipsis });
      continue;
    }

    const yClips = el.styles.overflowY === 'hidden' || el.styles.overflowY === 'clip';
    const yOverflow = el.scrollHeight - el.clientHeight;
    // A one-line rounding difference is not clipping; require a real slice of
    // a line to be missing before calling it.
    const lineHeight = el.styles.lineHeight ?? el.styles.fontSize * 1.2;
    if (yClips && yOverflow > Math.max(tol, lineHeight * 0.35)) {
      findings.push({ el, axis: 'vertical', amount: yOverflow, ellipsis: false });
    }
  }

  if (findings.length === 0) {
    return [
      buildResponsiveTest(ctx, {
        category: 'Clipping',
        check: 'clipping.text',
        title: 'No clipped text',
        element: 'all text elements',
        expected: 'All text is fully visible',
        actual: 'No clipped text found',
        difference: 'none',
        status: 'PASS',
        severity: 'none',
      }),
    ];
  }

  findings.sort((a, b) => b.amount - a.amount);

  const tests: ResponsiveTestResult[] = [];

  // Report the clean majority too, so one clipped label does not zero out the
  // whole Clipping category in the score.
  const clean = checked - findings.length;
  if (clean > 0) {
    tests.push(
      buildResponsiveTest(ctx, {
        category: 'Clipping',
        check: 'clipping.text',
        title: 'Text is fully visible',
        element: `${clean} of ${checked} text elements`,
        expected: 'Text fits within its container',
        actual: `${clean} text element${clean === 1 ? '' : 's'} render in full`,
        difference: 'none',
        status: 'PASS',
        severity: 'none',
      }),
    );
  }

  tests.push(...findings.slice(0, MAX_REPORTED).map((finding) => {
    const { el, axis, amount, ellipsis } = finding;
    const severity = ellipsis ? 'minor' : amount > 40 ? 'major' : 'minor';
    const nowrap = el.styles.whiteSpace === 'nowrap' || el.styles.whiteSpace === 'pre';

    return buildResponsiveTest(ctx, {
      category: 'Clipping',
      check: ellipsis ? 'clipping.truncated' : 'clipping.text',
      title: ellipsis ? 'Text truncated with ellipsis' : 'Text is clipped',
      element: el.label,
      selector: el.selector,
      expected: `Text fits within ${axis === 'horizontal' ? px(el.clientWidth) : px(el.clientHeight)}`,
      actual: `Content is ${axis === 'horizontal' ? px(el.scrollWidth) : px(el.scrollHeight)} — ${px(
        amount,
      )} hidden`,
      difference: `${px(amount)} clipped`,
      delta: round(amount),
      status: ellipsis ? 'WARNING' : 'FAIL',
      severity,
      message: ellipsis
        ? `"${el.ownText.slice(0, 60)}" is truncated with an ellipsis. Intentional, but confirm the full text is reachable at this viewport.`
        : `"${el.ownText.slice(0, 60)}" is cut off with no ellipsis, so ${px(amount)} of content is silently lost.${
            nowrap ? ' The element also has `white-space: nowrap`, which prevents it from wrapping.' : ''
          }`,
      highlight: el,
    });
  }));

  return tests;
}
