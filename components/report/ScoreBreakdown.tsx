'use client';

import type { ScoreResult } from '@/lib/types/report';
import { Meter } from '@/components/ui/primitives';

/** Transparent, per-dimension view of how a score was produced. */
export function ScoreBreakdown({ score, title }: { score: ScoreResult; title: string }) {
  const applicable = score.breakdown.filter((entry) => entry.applicable);
  const skipped = score.breakdown.filter((entry) => !entry.applicable);
  const weightSum = applicable.reduce((sum, e) => sum + e.weight, 0) || 1;

  return (
    <div className="panel p-4">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        <span className="tabular font-mono text-[13px] text-ink">{score.score}/100</span>
      </div>

      <div className="space-y-3">
        {applicable.map((entry) => {
          const effectiveWeight = entry.weight / weightSum;
          return (
            <div key={entry.key}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] text-ink">{entry.label}</span>
                <span className="tabular shrink-0 font-mono text-[11px] text-faint">
                  {entry.score} × {Math.round(effectiveWeight * 100)}%
                </span>
              </div>
              <Meter value={entry.score} />
              <p className="mt-1 font-mono text-[10.5px] text-faint">
                {entry.passed} pass · {entry.failed} fail · {entry.warnings} warn
              </p>
            </div>
          );
        })}
      </div>

      {skipped.length > 0 && (
        <p className="mt-4 border-t border-line pt-3 text-[11.5px] leading-relaxed text-faint">
          Not applicable (weights renormalized): {skipped.map((e) => e.label).join(', ')}.
        </p>
      )}

      <p className="mt-3 text-[11.5px] leading-relaxed text-faint">{score.methodology}</p>
    </div>
  );
}
