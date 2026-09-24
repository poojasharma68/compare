'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import type { CrossBrowserPair, CrossBrowserReport } from '@/lib/types/report';
import type { AnyTestResult } from '@/lib/types/tests';
import { browserLabel } from '@/lib/config/browsers';
import { Badge, EmptyState, Meter, SectionHeading, StatusIcon } from '@/components/ui/primitives';
import { ScoreBreakdown } from './ScoreBreakdown';
import { TestTable } from './TestTable';

const BROWSER_CATEGORIES = ['Page', 'Presence', 'Size', 'Position', 'Text'];

export function CrossBrowserSection({
  crossBrowser,
  onSelect,
  selectedId,
}: {
  crossBrowser: CrossBrowserReport;
  onSelect: (test: AnyTestResult) => void;
  selectedId: string | null;
}) {
  const [activePairId, setActivePairId] = useState<string | null>(
    // Open the worst comparison first — that is where the reader should look.
    crossBrowser.pairs.slice().sort((a, b) => a.score - b.score)[0]?.id ?? null,
  );

  const { rows, columns } = useMemo(() => {
    const columns = crossBrowser.browsers.filter((b) => b !== crossBrowser.referenceBrowser);
    const rows = new Map<string, { label: string; width: number; height: number; cells: Map<string, CrossBrowserPair> }>();
    for (const pair of crossBrowser.pairs) {
      let row = rows.get(pair.viewportId);
      if (!row) {
        row = { label: pair.viewportLabel, width: pair.width, height: pair.height, cells: new Map() };
        rows.set(pair.viewportId, row);
      }
      row.cells.set(pair.browser, pair);
    }
    return {
      columns,
      rows: [...rows.entries()].sort((a, b) => a[1].width - b[1].width || a[1].height - b[1].height),
    };
  }, [crossBrowser]);

  if (!crossBrowser.enabled) {
    return (
      <section>
        <SectionHeading title="Cross-browser testing" subtitle="Rendering compared between browser engines" />
        <EmptyState
          title="Cross-browser comparison was not run"
          body={crossBrowser.skippedReason ?? 'Select two or more browsers when starting an audit.'}
        />
      </section>
    );
  }

  const reference = browserLabel(crossBrowser.referenceBrowser);
  const active = crossBrowser.pairs.find((p) => p.id === activePairId) ?? null;

  return (
    <section>
      <SectionHeading
        title="Cross-browser testing"
        subtitle={`${crossBrowser.browsers.map((b) => browserLabel(b)).join(', ')} · every browser compared against ${reference} at the same viewport · select a cell to see what differs`}
      />

      <div className="mb-4 grid gap-3 lg:grid-cols-[260px_1fr]">
        <ScoreBreakdown score={crossBrowser.score} title="Cross-browser score" />

        <div className="scroll-thin overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[420px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-raised/60">
                <th className="px-3 py-2.5 text-[11px] font-medium uppercase tracking-wider text-faint">Viewport</th>
                <th className="px-3 py-2.5 text-[11px] font-medium uppercase tracking-wider text-faint">
                  {reference}
                  <span className="ml-1.5 normal-case tracking-normal text-faint">(reference)</span>
                </th>
                {columns.map((browser) => (
                  <th key={browser} className="px-3 py-2.5 text-[11px] font-medium uppercase tracking-wider text-faint">
                    {browserLabel(browser)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([viewportId, row]) => (
                <tr key={viewportId} className="border-b border-line/70 last:border-0">
                  <td className="px-3 py-2 font-mono text-[12.5px] text-ink">{row.label}</td>
                  <td className="px-3 py-2 text-[11.5px] text-faint">baseline</td>
                  {columns.map((browser) => {
                    const pair = row.cells.get(browser);
                    return (
                      <td key={browser} className="px-1.5 py-1.5">
                        {pair ? (
                          <PairCell pair={pair} active={pair.id === activePairId} onClick={() => setActivePairId(pair.id)} />
                        ) : (
                          <span className="px-2 text-[11.5px] text-faint">not analysed</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {active && (
        <div className="animate-rise">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-raised/50 px-4 py-3">
            <div className="flex items-center gap-3">
              <StatusIcon status={active.status} />
              <div>
                <p className="font-mono text-[13px] text-ink">
                  {browserLabel(active.browser)} vs {browserLabel(active.referenceBrowser)} · {active.viewportLabel}
                </p>
                <p className="text-[11.5px] text-faint">
                  {active.totals.passed} consistent · {active.totals.failed} failed · {active.totals.warnings} warnings
                </p>
              </div>
            </div>
            <span className="tabular font-mono text-[13px] text-ink">{active.score}%</span>
          </div>

          <TestTable
            key={active.id}
            tests={active.tests}
            categories={BROWSER_CATEGORIES.filter((c) => active.tests.some((t) => t.category === c))}
            onSelect={onSelect}
            selectedId={selectedId}
            emptyTitle="No cross-browser checks match these filters"
            emptyBody="Clear the filters to see every comparison made for this browser and viewport."
          />
        </div>
      )}
    </section>
  );
}

function PairCell({ pair, active, onClick }: { pair: CrossBrowserPair; active: boolean; onClick: () => void }) {
  const tone = pair.status === 'PASS' ? 'pass' : pair.status === 'WARNING' ? 'warn' : 'fail';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${browserLabel(pair.browser)} at ${pair.viewportLabel}: ${pair.score}%`}
      className={clsx(
        'w-full min-w-[120px] rounded-lg border px-2.5 py-1.5 text-left transition-all',
        active ? 'border-brand/50 bg-brand/8' : 'border-transparent hover:border-line-strong hover:bg-raised',
      )}
    >
      <span className="mb-1 flex items-center gap-1.5">
        <StatusIcon status={pair.status} />
        <span className="tabular font-mono text-[12.5px] text-ink">{pair.score}%</span>
        <span className="ml-auto flex items-center gap-1">
          {pair.totals.failed > 0 && <Badge tone="fail">{pair.totals.failed}</Badge>}
          {pair.totals.warnings > 0 && <Badge tone="warn">{pair.totals.warnings}</Badge>}
        </span>
      </span>
      <Meter value={pair.score} tone={tone} />
    </button>
  );
}
