'use client';

import { useEffect, useState } from 'react';
import type { AnyTestResult } from '@/lib/types/tests';
import { Badge, Button, StatusIcon, severityTone, statusTone } from '@/components/ui/primitives';
import { browserLabel } from '@/lib/config/browsers';
import { EvidenceViewer } from './EvidenceViewer';

/** Slide-over detail for a single test result. */
export function IssueDetail({
  test,
  runId,
  onClose,
}: {
  test: AnyTestResult;
  runId: string;
  onClose: () => void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showEvidence) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showEvidence]);

  const viewport = test.kind === 'ui' ? undefined : test.viewportLabel;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[#10131a]/35 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Details for ${test.id}`}
        className="scroll-thin fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-y-auto border-l border-line bg-panel shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-panel/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[13px] font-semibold text-brand">{test.id}</span>
              <Badge tone={statusTone(test.status)}>{test.status}</Badge>
              {test.severity !== 'none' && <Badge tone={severityTone(test.severity)}>{test.severity}</Badge>}
            </div>
            <h3 className="mt-1.5 text-[15px] font-semibold leading-snug text-ink">{test.title}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close details"
            className="shrink-0 rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {test.message && (
            <p className="rounded-lg border border-line bg-raised px-3.5 py-3 text-[13px] leading-relaxed text-muted">
              {test.message}
            </p>
          )}

          <dl className="space-y-3">
            <Row label="Category" value={test.category} />
            <Row label="Element" value={test.element} mono />
            {viewport && <Row label="Viewport" value={viewport} mono />}
            {test.kind === 'browser' && (
              <Row
                label="Compared"
                value={`${browserLabel(test.browser)} vs ${browserLabel(test.referenceBrowser)} (reference)`}
              />
            )}
            {test.selector && <Row label="Selector" value={test.selector} mono wrap />}
            {test.kind === 'ui' && test.figmaNodeId && <Row label="Figma node" value={test.figmaNodeId} mono />}
            {test.kind === 'ui' && typeof test.confidence === 'number' && (
              <Row label="Match confidence" value={`${Math.round(test.confidence * 100)}%`} mono />
            )}
            <Row label="Check" value={test.check} mono />
          </dl>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <ValueCard
              label={test.kind === 'browser' ? `Expected · ${browserLabel(test.referenceBrowser)}` : 'Expected'}
              value={test.expected}
              tone="expected"
            />
            <ValueCard
              label={test.kind === 'browser' ? `Actual · ${browserLabel(test.browser)}` : 'Actual'}
              value={test.actual}
              tone="actual"
            />
          </div>

          <div className="rounded-lg border border-line bg-raised px-3.5 py-3">
            <p className="text-[11px] uppercase tracking-wider text-faint">Difference</p>
            <p className="mt-1 font-mono text-[14px] text-ink">{test.difference}</p>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-line px-3.5 py-3">
            <StatusIcon status={test.status} />
            <span className="text-[13px] text-muted">
              {test.status === 'PASS'
                ? 'This check passed within tolerance.'
                : test.status === 'WARNING'
                  ? 'Within a tolerable band, but worth a look.'
                  : 'This check failed and needs attention.'}
            </span>
          </div>

          {test.evidence?.screenshotId ? (
            <Button variant="outline" className="w-full" onClick={() => setShowEvidence(true)}>
              View evidence
            </Button>
          ) : (
            <p className="text-center text-[11.5px] text-faint">
              No screenshot was captured for this check.
            </p>
          )}
        </div>
      </aside>

      {showEvidence && test.evidence && (
        <EvidenceViewer runId={runId} evidence={test.evidence} onClose={() => setShowEvidence(false)} />
      )}
    </>
  );
}

function Row({ label, value, mono, wrap }: { label: string; value: string; mono?: boolean; wrap?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-[12px] text-faint">{label}</dt>
      <dd
        className={`min-w-0 text-right text-[12.5px] text-ink ${mono ? 'font-mono' : ''} ${
          wrap ? 'break-all' : 'truncate'
        }`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function ValueCard({ label, value, tone }: { label: string; value: string; tone: 'expected' | 'actual' }) {
  return (
    <div
      className={`rounded-lg border px-3.5 py-3 ${
        tone === 'expected' ? 'border-line bg-raised' : 'border-line-strong bg-overlay'
      }`}
    >
      <p className="text-[11px] uppercase tracking-wider text-faint">{label}</p>
      <p className="mt-1 break-words font-mono text-[13px] leading-snug text-ink">{value}</p>
    </div>
  );
}
