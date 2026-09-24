'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import type { AuditReport } from '@/lib/types/report';
import type { AnyTestResult } from '@/lib/types/tests';
import { Badge, Button, Logo, SectionHeading, StatusIcon, severityTone } from '@/components/ui/primitives';
import { displayUrl } from '@/lib/utils/url';
import { SummaryCards } from './SummaryCards';
import { FigmaSection } from './FigmaSection';
import { ResponsiveSection } from './ResponsiveSection';
import { CrossBrowserSection } from './CrossBrowserSection';
import { IssueDetail } from './IssueDetail';

export function ReportView({ report }: { report: AuditReport }) {
  const [selected, setSelected] = useState<AnyTestResult | null>(null);
  const [showWarnings, setShowWarnings] = useState(false);

  const byId = useMemo(() => {
    const map = new Map<string, AnyTestResult>();
    for (const test of report.figma.tests) map.set(test.id, test);
    for (const test of report.responsive.tests) map.set(test.id, test);
    for (const test of report.crossBrowser?.tests ?? []) map.set(test.id, test);
    return map;
  }, [report]);

  const durationSeconds = (report.durationMs / 1000).toFixed(1);

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-8 sm:py-10">
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="mb-3 inline-flex items-center gap-2.5">
            <Logo />
            <span className="text-[15px] font-semibold tracking-tight text-ink">UIX-Ray</span>
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Audit report</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-muted">
            <a
              href={report.input.finalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-brand underline-offset-2 hover:underline"
            >
              {displayUrl(report.input.finalUrl, 56)}
            </a>
            <span className="text-line-strong">·</span>
            <span className="tabular font-mono">{durationSeconds}s</span>
            <span className="text-line-strong">·</span>
            <span className="tabular font-mono">{report.totals.total} checks</span>
            <span className="text-line-strong">·</span>
            <time dateTime={report.finishedAt} className="font-mono">
              {new Date(report.finishedAt).toLocaleString()}
            </time>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a href={`/api/audit/${report.runId}`} target="_blank" rel="noreferrer noopener">
            <Button variant="ghost" size="sm">
              Raw JSON
            </Button>
          </a>
          <Link href="/">
            <Button variant="outline" size="sm">
              New audit
            </Button>
          </Link>
        </div>
      </header>

      <div className="animate-rise">
        <SummaryCards report={report} />
      </div>

      {report.warnings.length > 0 && (
        <div className="mt-4 rounded-xl border border-line bg-raised/50">
          <button
            onClick={() => setShowWarnings((v) => !v)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          >
            <span className="flex items-center gap-2 text-[12.5px] text-muted">
              <Badge tone="warn">{report.warnings.length}</Badge>
              Notes from this run
            </span>
            <span className="text-[11.5px] text-faint">{showWarnings ? 'Hide' : 'Show'}</span>
          </button>
          {showWarnings && (
            <ul className="space-y-1.5 border-t border-line px-4 py-3">
              {report.warnings.map((warning, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-muted">
                  <span aria-hidden className="text-faint">
                    ›
                  </span>
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {report.topIssues.length > 0 && (
        <section className="mt-8 animate-rise">
          <SectionHeading
            title="Top issues"
            subtitle="Highest-severity findings across every module. Select one to see the full measurement."
          />
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {report.topIssues.map((issue) => {
              const test = byId.get(issue.id);
              return (
                <li key={issue.id}>
                  <button
                    onClick={() => test && setSelected(test)}
                    disabled={!test}
                    className={clsx(
                      'w-full rounded-xl border border-line bg-panel p-3.5 text-left transition-all',
                      test && 'hover:border-line-strong hover:bg-raised',
                    )}
                  >
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="font-mono text-[11.5px] text-brand">{issue.id}</span>
                      <Badge tone={severityTone(issue.severity)}>{issue.severity}</Badge>
                      {issue.viewportLabel && (
                        <span className="ml-auto truncate font-mono text-[11px] text-faint">
                          {describeSpread(issue)}
                        </span>
                      )}
                    </div>
                    <p className="flex items-start gap-1.5 text-[13px] font-medium leading-snug text-ink">
                      <StatusIcon status={issue.status} className="mt-0.5" />
                      <span className="min-w-0 flex-1">{issue.title}</span>
                    </p>
                    <p className="mt-1 truncate text-[12px] text-muted" title={issue.element}>
                      {issue.element}
                    </p>
                    <p className="mt-1 font-mono text-[11.5px] text-faint">{issue.difference}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="mt-10 animate-rise">
        <FigmaSection figma={report.figma} onSelect={setSelected} selectedId={selected?.id ?? null} />
      </div>

      <div className="mt-12 animate-rise">
        <ResponsiveSection
          responsive={report.responsive}
          runId={report.runId}
          onSelect={setSelected}
          selectedId={selected?.id ?? null}
        />
      </div>

      {report.crossBrowser && (
        <div className="mt-12 animate-rise">
          <CrossBrowserSection
            crossBrowser={report.crossBrowser}
            onSelect={setSelected}
            selectedId={selected?.id ?? null}
          />
        </div>
      )}

      <footer className="mt-14 border-t border-line pt-5">
        <p className="text-[11.5px] leading-relaxed text-faint">
          Every verdict in this report was derived from Figma node metadata, DOM structure, computed CSS and element
          geometry. Screenshots are attached to failures as supporting evidence only and never contribute to a score.
        </p>
        <details className="mt-3">
          <summary className="cursor-pointer text-[11.5px] text-muted">Tolerances used for this run</summary>
          <div className="mt-2 grid gap-x-6 gap-y-1 font-mono text-[11px] text-faint sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(report.tolerances).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-3">
                <span>{key}</span>
                <span className="tabular text-muted">{value}</span>
              </div>
            ))}
          </div>
        </details>
      </footer>

      {selected && <IssueDetail test={selected} runId={report.runId} onClose={() => setSelected(null)} />}
    </main>
  );
}

/** Where an issue shows up: one viewport, or how widely it recurs. */
function describeSpread(issue: AuditReport['topIssues'][number]): string {
  const viewports = issue.viewportCount ?? 1;
  const browsers = issue.browserCount ?? 1;
  if (viewports <= 1 && browsers <= 1) return issue.viewportLabel ?? '';
  const [size, browser] = (issue.viewportLabel ?? '').split(' · ');
  const parts: string[] = [viewports > 1 ? `${viewports} viewports` : size];
  // "Only in Firefox" is the point of a cross-browser finding, so name the
  // browser whenever there is just one.
  if (browsers > 1) parts.push(`${browsers} browsers`);
  else if (browser) parts.push(browser);
  return parts.join(' · ');
}
