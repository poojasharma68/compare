'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import type { AuditStep, RunState } from '@/lib/types/run';
import { Button, Logo } from '@/components/ui/primitives';
import { displayUrl } from '@/lib/utils/url';

export function RunProgress({ runId }: { runId: string }) {
  const router = useRouter();
  const [state, setState] = useState<RunState | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const navigated = useRef(false);

  useEffect(() => {
    const source = new EventSource(`/api/audit/${runId}/stream`);

    source.onmessage = (event) => {
      try {
        const next = JSON.parse(event.data) as RunState;
        setState(next);
        setConnectionError(null);
        if (next.status === 'completed' && !navigated.current) {
          navigated.current = true;
          source.close();
          // Let the final "done" frame render before moving on.
          setTimeout(() => router.replace(`/report/${runId}`), 450);
        }
        if (next.status === 'failed') source.close();
      } catch {
        /* ignore malformed frames */
      }
    };

    source.onerror = () => {
      // The stream also closes normally when a run finishes; only treat it as
      // an error while the run is still in flight.
      if (source.readyState === EventSource.CLOSED && !navigated.current) {
        void fetch(`/api/audit/${runId}`)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('missing'))))
          .then((run: RunState) => {
            setState(run);
            if (run.status === 'completed' && !navigated.current) {
              navigated.current = true;
              router.replace(`/report/${runId}`);
            }
          })
          .catch(() => setConnectionError('Lost connection to the audit stream.'));
      }
    };

    return () => source.close();
  }, [runId, router]);

  const steps = state?.steps ?? [];
  const failed = state?.status === 'failed';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 py-10 sm:py-16">
      <header className="mb-10 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight text-ink">UIX-Ray</span>
        </Link>
        <span className="font-mono text-[11px] text-faint">{runId}</span>
      </header>

      <div className="panel animate-rise p-6 sm:p-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold tracking-tight text-ink">
            {failed ? 'Audit failed' : state?.status === 'completed' ? 'Audit complete' : 'Running audit'}
          </h1>
          {state && (
            <p className="mt-1 truncate font-mono text-[12px] text-muted">
              {displayUrl(state.input.websiteUrl, 64)}
              {state.input.figmaUrl && <span className="text-faint"> · Figma linked</span>}
            </p>
          )}
        </div>

        {!failed && (
          <div className="mb-7">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[12px] text-muted">
                {state?.status === 'completed' ? 'Opening report…' : 'Progress'}
              </span>
              <span className="tabular font-mono text-[12px] text-ink">{state?.progress ?? 0}%</span>
            </div>
            <div className="relative h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out"
                style={{ width: `${state?.progress ?? 0}%` }}
              />
              {state?.status === 'running' && (
                <div className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-brand-glow/35 to-transparent animate-sweep" />
              )}
            </div>
          </div>
        )}

        <ol className="space-y-0.5">
          {steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
          {steps.length === 0 && !connectionError && (
            <li className="py-2 text-[13px] text-muted">Connecting to the audit stream…</li>
          )}
        </ol>

        {failed && state?.error && (
          <div className="mt-7 rounded-lg border border-fail/30 bg-fail/8 p-4">
            <p className="text-[13px] font-medium text-fail">{state.error.message}</p>
            {state.error.hint && <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{state.error.hint}</p>}
            {state.error.code && (
              <p className="mt-2 font-mono text-[11px] text-faint">error code: {state.error.code}</p>
            )}
            <div className="mt-4 flex gap-2">
              <Link href="/">
                <Button variant="outline" size="sm">
                  Start a new audit
                </Button>
              </Link>
            </div>
          </div>
        )}

        {connectionError && !failed && (
          <div className="mt-7 rounded-lg border border-warn/30 bg-warn/8 p-4">
            <p className="text-[13px] text-warn">{connectionError}</p>
            <p className="mt-1.5 text-[12.5px] text-muted">
              The audit may still be running on the server. Reload this page to reconnect.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function StepRow({ step }: { step: AuditStep }) {
  const duration =
    step.startedAt && step.finishedAt ? `${((step.finishedAt - step.startedAt) / 1000).toFixed(1)}s` : null;

  return (
    <li
      className={clsx(
        'flex items-start gap-3 rounded-lg px-2.5 py-2 transition-colors',
        step.status === 'active' && 'bg-raised',
      )}
    >
      <StepMarker status={step.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span
            className={clsx(
              'text-[13px]',
              step.status === 'done' && 'text-ink',
              step.status === 'active' && 'font-medium text-ink',
              step.status === 'pending' && 'text-faint',
              step.status === 'skipped' && 'text-faint line-through decoration-line-strong',
              step.status === 'failed' && 'text-fail',
            )}
          >
            {step.label}
          </span>
          {duration && <span className="tabular shrink-0 font-mono text-[11px] text-faint">{duration}</span>}
        </div>
        {step.detail && (
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted" title={step.detail}>
            {step.detail}
          </p>
        )}
      </div>
    </li>
  );
}

function StepMarker({ status }: { status: AuditStep['status'] }) {
  if (status === 'active') {
    return (
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </span>
    );
  }

  const glyph = status === 'done' ? '✓' : status === 'failed' ? '✕' : status === 'skipped' ? '–' : '';

  return (
    <span
      aria-hidden
      className={clsx(
        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold',
        status === 'done' && 'border-pass/40 bg-pass/12 text-pass',
        status === 'failed' && 'border-fail/40 bg-fail/12 text-fail',
        status === 'skipped' && 'border-line bg-raised text-faint',
        status === 'pending' && 'border-line text-transparent',
      )}
    >
      {glyph}
    </span>
  );
}
