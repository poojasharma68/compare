'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TestEvidence } from '@/lib/types/tests';

/**
 * Supporting evidence only. Every verdict in this report comes from measured
 * geometry and computed styles — the screenshot exists so a person can see what
 * the numbers describe.
 */
export function EvidenceViewer({
  runId,
  evidence,
  onClose,
}: {
  runId: string;
  evidence: TestEvidence;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const { pageWidth, pageHeight, highlight } = evidence;
  const canHighlight = Boolean(highlight && pageWidth && pageHeight);

  /**
   * A full-page capture can be many thousands of pixels tall, so opening at the
   * top would show the header no matter where the finding actually is. Centre
   * the highlighted element instead.
   */
  const revealHighlight = useCallback(() => {
    setLoaded(true);
    const container = scrollRef.current;
    const frame = frameRef.current;
    if (!container || !frame || !highlight || !pageHeight) return;

    const renderedHeight = frame.clientHeight;
    if (renderedHeight <= 0) return;
    const centre = ((highlight.y + highlight.height / 2) / pageHeight) * renderedHeight;
    container.scrollTop = Math.max(0, centre - container.clientHeight / 2);
  }, [highlight, pageHeight]);

  if (!evidence.screenshotId) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Evidence screenshot"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#10131a]/45 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="panel flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink">Visual evidence</p>
            <p className="truncate font-mono text-[11px] text-faint">{evidence.caption ?? 'Captured viewport'}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[12px] text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            Close ✕
          </button>
        </div>

        <div ref={scrollRef} className="scroll-thin flex-1 overflow-auto bg-overlay p-4">
          <div ref={frameRef} className="relative mx-auto w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/evidence/${runId}/${evidence.screenshotId}`}
              alt={evidence.caption ?? 'Evidence screenshot'}
              onLoad={revealHighlight}
              className="block max-w-full rounded-md border border-line"
              style={{ width: pageWidth ? Math.min(pageWidth, 900) : undefined }}
            />
            {loaded && canHighlight && highlight && pageWidth && pageHeight && (
              <div
                className="pointer-events-none absolute rounded-[3px] border-2 border-fail ring-2 ring-fail/40 shadow-[0_0_0_9999px_rgba(16,19,26,0.38)]"
                style={{
                  left: `${(highlight.x / pageWidth) * 100}%`,
                  top: `${(highlight.y / pageHeight) * 100}%`,
                  width: `${(highlight.width / pageWidth) * 100}%`,
                  height: `${(highlight.height / pageHeight) * 100}%`,
                }}
              />
            )}
          </div>
        </div>

        <p className="border-t border-line px-4 py-2.5 text-[11.5px] leading-relaxed text-faint">
          {canHighlight ? 'Scrolled to the highlighted element. ' : ''}Screenshots are supporting evidence. The test result itself was derived from DOM geometry and computed styles,
          not from comparing pixels.
        </p>
      </div>
    </div>
  );
}
