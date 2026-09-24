'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import type { ResponsiveReport, ViewportReport } from '@/lib/types/report';
import type { AnyTestResult } from '@/lib/types/tests';
import { browserLabel, type BrowserName } from '@/lib/config/browsers';
import { Badge, Meter, SectionHeading, StatusIcon } from '@/components/ui/primitives';
import { ScoreBreakdown } from './ScoreBreakdown';
import { TestTable } from './TestTable';
import { EvidenceViewer } from './EvidenceViewer';

const RESPONSIVE_CATEGORIES = ['Overflow', 'Overlap', 'Clipping', 'Wrapping', 'Visibility', 'Layout', 'Image'];

export function ResponsiveSection({
  responsive,
  runId,
  onSelect,
  selectedId,
}: {
  responsive: ResponsiveReport;
  runId: string;
  onSelect: (test: AnyTestResult) => void;
  selectedId: string | null;
}) {
  // Open the worst viewport first — that is where the reader should look.
  const worst = responsive.viewports.slice().sort((a, b) => a.score - b.score)[0];
  const [activeViewportId, setActiveViewportId] = useState<string | null>(worst?.viewport.id ?? null);
  const [evidenceFor, setEvidenceFor] = useState<ViewportReport | null>(null);

  const browsers = useMemo(() => {
    const seen: string[] = [];
    for (const v of responsive.viewports) {
      const name = v.viewport.browser ?? 'chromium';
      if (!seen.includes(name)) seen.push(name);
    }
    return seen;
  }, [responsive.viewports]);
  const multiBrowser = browsers.length > 1;
  const [activeBrowser, setActiveBrowser] = useState<string>(worst?.viewport.browser ?? browsers[0] ?? 'chromium');

  const shown = multiBrowser
    ? responsive.viewports.filter((v) => (v.viewport.browser ?? 'chromium') === activeBrowser)
    : responsive.viewports;
  const active = shown.find((v) => v.viewport.id === activeViewportId) ?? null;

  const selectBrowser = (name: string) => {
    setActiveBrowser(name);
    const inBrowser = responsive.viewports.filter((v) => (v.viewport.browser ?? 'chromium') === name);
    // Keep the same size open when switching engines, so the two are easy to compare.
    const current = responsive.viewports.find((v) => v.viewport.id === activeViewportId);
    const sameSize = inBrowser.find((v) => current && v.viewport.baseId === current.viewport.baseId);
    setActiveViewportId((sameSize ?? inBrowser.slice().sort((a, b) => a.score - b.score)[0])?.viewport.id ?? null);
  };

  return (
    <section>
      <SectionHeading
        title="Responsive testing"
        subtitle={
          multiBrowser
            ? `${shown.length} viewports × ${browsers.length} browsers · ${responsive.totals.total} checks · every viewport is tested in every browser`
            : `${responsive.viewports.length} viewports · ${responsive.totals.total} checks · select a viewport to see its results`
        }
      />

      {multiBrowser && (
        <div className="mb-3 flex flex-wrap items-center gap-1 rounded-lg border border-line bg-raised p-1" role="tablist">
          {browsers.map((name) => {
            const inBrowser = responsive.viewports.filter((v) => (v.viewport.browser ?? 'chromium') === name);
            const failing = inBrowser.filter((v) => v.status === 'FAIL').length;
            const mean = inBrowser.length
              ? Math.round(inBrowser.reduce((sum, v) => sum + v.score, 0) / inBrowser.length)
              : 0;
            return (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={activeBrowser === name}
                onClick={() => selectBrowser(name)}
                className={clsx(
                  'flex items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                  activeBrowser === name ? 'bg-brand text-on-brand' : 'text-muted hover:bg-overlay hover:text-ink',
                )}
              >
                {browserLabel(name as BrowserName)}
                <span className={clsx('tabular font-mono text-[11px]', activeBrowser === name ? 'opacity-75' : 'text-faint')}>
                  {mean}%
                </span>
                {failing > 0 && (
                  <span
                    className={clsx(
                      'tabular font-mono text-[10.5px]',
                      activeBrowser === name ? 'opacity-75' : 'text-fail',
                    )}
                  >
                    {failing} failing
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="mb-4 grid gap-3 lg:grid-cols-[260px_1fr]">
        <ScoreBreakdown score={responsive.score} title="Responsive score" />

        <div className="grid content-start gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((viewport) => (
            <ViewportCard
              key={viewport.viewport.id}
              viewport={viewport}
              active={viewport.viewport.id === activeViewportId}
              onClick={() => setActiveViewportId(viewport.viewport.id)}
            />
          ))}
        </div>
      </div>

      {active && (
        <div className="animate-rise">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-raised/50 px-4 py-3">
            <div className="flex items-center gap-3">
              <StatusIcon status={active.status} />
              <div>
                <p className="font-mono text-[13px] text-ink">{active.viewport.label}</p>
                <p className="text-[11.5px] text-faint">
                  {active.totals.passed} passed · {active.totals.failed} failed · {active.totals.warnings} warnings
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11.5px] text-faint">
                document {Math.round(active.metrics.scrollWidth)}px / viewport {Math.round(active.metrics.clientWidth)}
                px
              </span>
              {active.screenshot && (
                <button
                  onClick={() => setEvidenceFor(active)}
                  className="rounded-md border border-line-strong px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-brand/60 hover:text-ink"
                >
                  View screenshot
                </button>
              )}
            </div>
          </div>

          {active.warnings.length > 0 && (
            <div className="mb-3 rounded-lg border border-warn/25 bg-warn/6 px-3.5 py-2.5">
              <p className="text-[11.5px] font-medium text-warn">Capture notes</p>
              <ul className="mt-1 space-y-0.5">
                {active.warnings.slice(0, 3).map((warning, i) => (
                  <li key={i} className="text-[11.5px] leading-relaxed text-muted">
                    {warning}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <TestTable
            key={active.viewport.id}
            tests={active.tests}
            categories={RESPONSIVE_CATEGORIES.filter((c) => active.tests.some((t) => t.category === c))}
            onSelect={onSelect}
            selectedId={selectedId}
            emptyTitle="No responsive checks match these filters"
            emptyBody="Clear the filters to see every check run at this viewport."
          />
        </div>
      )}

      {evidenceFor?.screenshot && (
        <EvidenceViewer
          runId={runId}
          evidence={{
            screenshotId: evidenceFor.screenshot.id,
            pageWidth: evidenceFor.screenshot.width,
            pageHeight: evidenceFor.screenshot.height,
            caption: `${evidenceFor.viewport.label} · full page capture`,
          }}
          onClose={() => setEvidenceFor(null)}
        />
      )}
    </section>
  );
}

function ViewportCard({
  viewport,
  active,
  onClick,
}: {
  viewport: ViewportReport;
  active: boolean;
  onClick: () => void;
}) {
  const tone = viewport.status === 'PASS' ? 'pass' : viewport.status === 'WARNING' ? 'warn' : 'fail';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'group rounded-xl border p-3.5 text-left transition-all',
        active
          ? 'border-brand/50 bg-brand/8'
          : 'border-line bg-panel hover:border-line-strong hover:bg-raised',
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[13px] text-ink">{viewport.viewport.baseLabel ?? viewport.viewport.label}</span>
        <span className="flex items-center gap-1.5">
          <StatusIcon status={viewport.status} />
          <span className="tabular font-mono text-[13px] text-ink">{viewport.score}%</span>
        </span>
      </div>

      <Meter value={viewport.score} tone={tone} />

      <div className="mt-2.5 flex items-center gap-1.5">
        <span className="text-[11px] capitalize text-faint">
          {viewport.viewport.group}
          {viewport.viewport.custom && ' · custom'}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {viewport.totals.failed > 0 && <Badge tone="fail">{viewport.totals.failed}</Badge>}
          {viewport.totals.warnings > 0 && <Badge tone="warn">{viewport.totals.warnings}</Badge>}
          {viewport.totals.failed === 0 && viewport.totals.warnings === 0 && (
            <Badge tone="pass">clean</Badge>
          )}
        </span>
      </div>
    </button>
  );
}
