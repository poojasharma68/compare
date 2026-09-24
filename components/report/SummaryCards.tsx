'use client';

import clsx from 'clsx';
import type { AuditReport, ScoreResult } from '@/lib/types/report';
import { InfoTooltip, Meter, ScoreRing } from '@/components/ui/primitives';

export function SummaryCards({ report }: { report: AuditReport }) {
  const { figma, responsive, crossBrowser, totals } = report;
  const uiAvailable = figma.enabled && figma.tests.length > 0;
  const showBrowsers = Boolean(crossBrowser?.enabled);

  return (
    <div className={clsx('grid gap-3 sm:grid-cols-2', showBrowsers ? 'lg:grid-cols-3 xl:grid-cols-5' : 'lg:grid-cols-4')}>
      <ScoreCard
        label="UI Match"
        score={uiAvailable ? figma.score.score : null}
        unavailable={
          !figma.enabled
            ? 'No Figma URL provided'
            : figma.skippedReason
              ? 'Figma comparison skipped'
              : 'No comparable elements'
        }
        methodology={figma.score}
        detail={
          uiAvailable
            ? `${figma.totals.passed}/${figma.totals.total} checks passed`
            : undefined
        }
      />

      <ScoreCard
        label="Responsive"
        score={responsive.viewports.length > 0 ? responsive.score.score : null}
        unavailable="No viewport was analysed"
        methodology={responsive.score}
        detail={
          responsive.viewports.length > 0
            ? `${responsive.viewports.length} ${showBrowsers ? 'page loads' : 'viewports'} · ${responsive.totals.passed}/${responsive.totals.total} passed`
            : undefined
        }
      />

      {showBrowsers && crossBrowser && (
        <ScoreCard
          label="Cross-browser"
          score={crossBrowser.pairs.length > 0 ? crossBrowser.score.score : null}
          unavailable="No browser comparison completed"
          methodology={crossBrowser.score}
          detail={`${crossBrowser.browsers.length} browsers · ${crossBrowser.totals.failed + crossBrowser.totals.warnings} differences`}
        />
      )}

      <StatCard
        label="Total tests"
        value={totals.total}
        rows={[
          { label: 'Passed', value: totals.passed, tone: 'pass' },
          { label: 'Failed', value: totals.failed, tone: 'fail' },
          { label: 'Warnings', value: totals.warnings, tone: 'warn' },
        ]}
      />

      <StatCard
        label="Issues by severity"
        value={totals.critical + totals.major + totals.minor}
        rows={[
          { label: 'Critical', value: totals.critical, tone: 'critical' },
          { label: 'Major', value: totals.major, tone: 'fail' },
          { label: 'Minor', value: totals.minor, tone: 'warn' },
        ]}
      />
    </div>
  );
}

function ScoreCard({
  label,
  score,
  unavailable,
  methodology,
  detail,
}: {
  label: string;
  score: number | null;
  unavailable: string;
  methodology: ScoreResult;
  detail?: string;
}) {
  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center gap-1.5">
        <span className="text-[12px] font-medium uppercase tracking-wider text-faint">{label}</span>
        <InfoTooltip title="How this score is calculated">{methodology.methodology}</InfoTooltip>
      </div>

      {score === null ? (
        <div className="flex h-[68px] items-center">
          <p className="text-[12.5px] leading-relaxed text-faint">{unavailable}</p>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <ScoreRing value={score} />
          <div className="min-w-0 flex-1 space-y-2">
            {methodology.breakdown
              .filter((entry) => entry.applicable)
              .slice(0, 3)
              .map((entry) => (
                <div key={entry.key}>
                  <div className="mb-0.5 flex items-baseline justify-between gap-2">
                    <span className="truncate text-[11px] text-muted">{entry.label}</span>
                    <span className="tabular shrink-0 font-mono text-[11px] text-faint">{entry.score}</span>
                  </div>
                  <Meter value={entry.score} />
                </div>
              ))}
          </div>
        </div>
      )}

      {detail && <p className="mt-3 text-[11.5px] text-faint">{detail}</p>}
    </div>
  );
}

function StatCard({
  label,
  value,
  rows,
}: {
  label: string;
  value: number;
  rows: Array<{ label: string; value: number; tone: 'pass' | 'fail' | 'warn' | 'critical' }>;
}) {
  return (
    <div className="panel p-4">
      <span className="text-[12px] font-medium uppercase tracking-wider text-faint">{label}</span>
      <p className="tabular mt-2 text-3xl font-semibold leading-none text-ink">{value}</p>
      <div className="mt-4 space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[12px] text-muted">
              <span
                aria-hidden
                className={clsx(
                  'h-1.5 w-1.5 rounded-full',
                  row.tone === 'pass' && 'bg-pass',
                  row.tone === 'fail' && 'bg-fail',
                  row.tone === 'warn' && 'bg-warn',
                  row.tone === 'critical' && 'bg-critical',
                )}
              />
              {row.label}
            </span>
            <span className="tabular font-mono text-[12px] text-ink">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
