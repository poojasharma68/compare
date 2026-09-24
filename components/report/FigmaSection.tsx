'use client';

import type { AnyTestResult } from '@/lib/types/tests';
import type { FigmaComparisonReport } from '@/lib/types/report';
import { Badge, EmptyState, SectionHeading } from '@/components/ui/primitives';
import { ScoreBreakdown } from './ScoreBreakdown';
import { TestTable } from './TestTable';

const UI_CATEGORIES = ['Layout', 'Spacing', 'Typography', 'Color', 'Styling', 'Structure'];

export function FigmaSection({
  figma,
  onSelect,
  selectedId,
}: {
  figma: FigmaComparisonReport;
  onSelect: (test: AnyTestResult) => void;
  selectedId: string | null;
}) {
  if (!figma.enabled) {
    return (
      <section>
        <SectionHeading title="Figma UI comparison" />
        <EmptyState
          title="No Figma design was linked"
          body="Add a Figma frame URL when starting an audit to compare the live implementation against the design."
          icon="◇"
        />
      </section>
    );
  }

  if (figma.skippedReason || figma.tests.length === 0) {
    return (
      <section>
        <SectionHeading title="Figma UI comparison" />
        <div className="rounded-xl border border-warn/25 bg-warn/6 p-5">
          <p className="text-[13px] font-medium text-warn">Figma comparison could not run</p>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">
            {figma.skippedReason ??
              'No Figma layer could be matched to an element on the page, so there was nothing to compare. Check that the frame and the URL describe the same screen.'}
          </p>
          <p className="mt-3 text-[12px] text-faint">
            Responsive testing ran independently and its results below are unaffected.
          </p>
        </div>
      </section>
    );
  }

  const matching = figma.matching;

  return (
    <section>
      <SectionHeading
        title="Figma UI comparison"
        subtitle={
          figma.design ? (
            <>
              <span className="text-ink">{figma.design.frameName}</span> ({figma.design.frameWidth}×
              {figma.design.frameHeight}) from {figma.design.fileName}
              {figma.comparedViewport && <> · compared at {figma.comparedViewport.label}</>}
              {typeof figma.scaleFactor === 'number' && Math.abs(figma.scaleFactor - 1) > 0.001 && (
                <> · geometry scaled {(figma.scaleFactor * 100).toFixed(0)}%</>
              )}
            </>
          ) : undefined
        }
      />

      <div className="mb-4 grid gap-3 lg:grid-cols-[260px_1fr]">
        <ScoreBreakdown score={figma.score} title="UI score" />

        <div className="grid content-start gap-3 sm:grid-cols-2">
          {matching && (
            <div className="panel p-4">
              <h3 className="mb-3 text-[13px] font-semibold text-ink">Element matching</h3>
              <dl className="space-y-2">
                <Stat label="Matched layers" value={matching.matches.length} tone="pass" />
                <Stat label="Missing from page" value={matching.missing.length} tone="fail" />
                <Stat label="Extra on page" value={matching.extra.length} tone="warn" />
                <Stat
                  label="Average confidence"
                  value={`${Math.round(matching.averageConfidence * 100)}%`}
                  tone="neutral"
                />
                <Stat
                  label="Mapped to page region"
                  value={`${matching.registration.top}–${matching.registration.bottom}px`}
                  tone="neutral"
                />
              </dl>
              <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
                {matching.consideredFigmaNodes} design layers were weighed against {matching.consideredDomElements}{' '}
                page elements using text, type, geometry, naming and hierarchy signals. The frame was located on the
                page from {matching.registration.anchors} confident anchor
                {matching.registration.anchors === 1 ? '' : 's'}; only elements inside that band were compared.
              </p>
            </div>
          )}

          <div className="panel p-4">
            <h3 className="mb-3 text-[13px] font-semibold text-ink">Results by category</h3>
            <div className="space-y-2">
              {figma.categoryTotals
                .filter((entry) => entry.totals.total > 0)
                .map((entry) => (
                  <div key={entry.category} className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] text-muted">{entry.category}</span>
                    <span className="flex items-center gap-1.5">
                      {entry.totals.passed > 0 && <Badge tone="pass">{entry.totals.passed}</Badge>}
                      {entry.totals.warnings > 0 && <Badge tone="warn">{entry.totals.warnings}</Badge>}
                      {entry.totals.failed > 0 && <Badge tone="fail">{entry.totals.failed}</Badge>}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      <TestTable
        tests={figma.tests}
        categories={UI_CATEGORIES.filter((c) => figma.tests.some((t) => t.category === c))}
        onSelect={onSelect}
        selectedId={selectedId}
        emptyTitle="No UI checks match these filters"
        emptyBody="Clear the filters to see every comparison the engine ran."
      />
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd
        className={`tabular font-mono text-[13px] ${
          tone === 'pass' ? 'text-pass' : tone === 'fail' ? 'text-fail' : tone === 'warn' ? 'text-warn' : 'text-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
