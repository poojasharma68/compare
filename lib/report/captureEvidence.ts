import type { EvidenceCapturer } from '@/lib/browser/pageAnalyzer';
import type { AnyTestResult } from '@/lib/types/tests';

/** Findings within this vertical distance share one screenshot. */
const BUCKET_HEIGHT = 240;

export interface CaptureOptions {
  /**
   * Upper bound on screenshots per viewport. Each capture costs a scroll and a
   * render, so this is what keeps a nine-viewport audit from turning into a
   * hundred screenshots. Findings beyond the budget keep every measured value —
   * they just have no picture attached.
   */
  maxShots?: number;
  viewportHeight: number;
}

/**
 * Captures one screenful of evidence around each failing element.
 *
 * Findings that sit close together reuse a single screenshot, so a section with
 * six problems costs one capture rather than six. Highlights are rebased from
 * document coordinates into the captured window, which is what lets a finding
 * 18,000px down a page get evidence that actually shows it.
 */
export async function captureFindingEvidence(
  tests: AnyTestResult[],
  capture: EvidenceCapturer,
  options: CaptureOptions,
): Promise<number> {
  const maxShots = options.maxShots ?? 6;

  const pending = tests.filter(
    (test) => test.status !== 'PASS' && test.status !== 'SKIPPED' && test.evidence?.highlight,
  );
  if (pending.length === 0) return 0;

  // Worst first, so the capture budget is spent where it matters most.
  const severityRank: Record<string, number> = { critical: 0, major: 1, minor: 2, none: 3 };
  pending.sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9));

  const buckets = new Map<number, AnyTestResult[]>();
  for (const test of pending) {
    const y = test.evidence!.highlight!.y;
    const key = Math.floor(y / BUCKET_HEIGHT);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(test);
    else buckets.set(key, [test]);
  }

  let shotsTaken = 0;

  for (const bucket of buckets.values()) {
    if (shotsTaken >= maxShots) break;

    const anchor = bucket[0].evidence!.highlight!;
    const shot = await capture.captureAround(anchor);
    if (!shot) continue;
    shotsTaken++;

    for (const test of bucket) {
      const highlight = test.evidence!.highlight!;
      const localY = highlight.y - shot.offsetY;

      test.evidence = {
        ...test.evidence,
        screenshotId: shot.id,
        pageWidth: shot.width,
        pageHeight: shot.height,
        // A highlight scrolled out of the captured window is dropped rather
        // than drawn in the wrong place; the screenshot still gives context.
        // Anything partially visible is clipped to the frame so the box cannot
        // paint outside the image it belongs to.
        highlight: clampToFrame(highlight, localY, shot.width, shot.height),
      };
    }
  }

  return shotsTaken;
}

function clampToFrame(
  highlight: { x: number; y: number; width: number; height: number },
  localY: number,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number; width: number; height: number } | undefined {
  if (localY + highlight.height <= 0 || localY >= frameHeight) return undefined;

  const top = Math.max(0, localY);
  const left = Math.max(0, highlight.x);
  const height = Math.min(highlight.height + Math.min(0, localY), frameHeight - top);
  const width = Math.min(highlight.width + Math.min(0, highlight.x), frameWidth - left);

  if (height <= 0 || width <= 0) return undefined;
  return { x: left, y: top, width, height };
}
