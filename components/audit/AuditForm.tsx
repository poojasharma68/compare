'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import clsx from 'clsx';
import { CUSTOM_VIEWPORT_LIMITS, VIEWPORT_GROUPS, VIEWPORTS, type CustomViewport } from '@/lib/config/viewports';
import { BROWSERS, type BrowserName } from '@/lib/config/browsers';
import { Button, Field, Input } from '@/components/ui/primitives';

interface FieldErrors {
  figmaUrl?: string;
  websiteUrl?: string;
  viewportGroups?: string;
  browsers?: string;
  custom?: string;
  form?: string;
  hint?: string;
}

export function AuditForm({ hasServerToken }: { hasServerToken: boolean }) {
  const router = useRouter();
  const [figmaUrl, setFigmaUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [figmaToken, setFigmaToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [groups, setGroups] = useState<string[]>(['mobile', 'tablet', 'desktop']);
  const [browsers, setBrowsers] = useState<BrowserName[]>(['chromium']);
  const [customSizes, setCustomSizes] = useState<CustomViewport[]>([]);
  const [customWidth, setCustomWidth] = useState('');
  const [customHeight, setCustomHeight] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const toggleGroup = (id: string) => {
    setGroups((current) => (current.includes(id) ? current.filter((g) => g !== id) : [...current, id]));
    setErrors((e) => ({ ...e, viewportGroups: undefined }));
  };

  const toggleBrowser = (id: BrowserName) => {
    setBrowsers((current) => (current.includes(id) ? current.filter((b) => b !== id) : [...current, id]));
    setErrors((e) => ({ ...e, browsers: undefined }));
  };

  const addCustomSize = () => {
    const L = CUSTOM_VIEWPORT_LIMITS;
    const width = Number(customWidth);
    const height = Number(customHeight);
    let problem: string | undefined;
    if (!customWidth || !Number.isInteger(width) || width < L.minWidth || width > L.maxWidth) {
      problem = `Width must be a whole number from ${L.minWidth} to ${L.maxWidth}.`;
    } else if (!customHeight || !Number.isInteger(height) || height < L.minHeight || height > L.maxHeight) {
      problem = `Height must be a whole number from ${L.minHeight} to ${L.maxHeight}.`;
    } else if (customSizes.some((c) => c.width === width && c.height === height)) {
      problem = `${width} × ${height} is already in the list.`;
    } else if (customSizes.length >= L.max) {
      problem = `Up to ${L.max} custom sizes per audit.`;
    }
    if (problem) {
      setErrors((e) => ({ ...e, custom: problem }));
      return;
    }
    setCustomSizes((current) => [...current, { width, height }]);
    setCustomWidth('');
    setCustomHeight('');
    setErrors((e) => ({ ...e, custom: undefined, viewportGroups: undefined }));
  };

  const removeCustomSize = (size: CustomViewport) =>
    setCustomSizes((current) => current.filter((c) => c.width !== size.width || c.height !== size.height));

  // Page loads, not viewports, are what an audit spends its time on.
  const presets = VIEWPORTS.filter((v) => groups.includes(v.group));
  const viewportCount =
    presets.length + customSizes.filter((c) => !presets.some((v) => v.width === c.width && v.height === c.height)).length;
  const browserCount = Math.max(1, browsers.length);
  const pageLoads = viewportCount * browserCount;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});

    if (!websiteUrl.trim()) {
      setErrors({ websiteUrl: 'Enter the website you want audited.' });
      return;
    }
    if (groups.length === 0 && customSizes.length === 0) {
      setErrors({ viewportGroups: 'Select a viewport group or add a custom size.' });
      return;
    }
    if (browsers.length === 0) {
      setErrors({ browsers: 'Select at least one browser.' });
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          figmaUrl: figmaUrl.trim() || null,
          websiteUrl: websiteUrl.trim(),
          viewportGroups: groups,
          customViewports: customSizes,
          browsers,
          figmaToken: figmaToken.trim() || null,
        }),
      });

      const data = (await response.json()) as {
        runId?: string;
        error?: string;
        hint?: string;
        field?: string;
      };

      if (!response.ok || !data.runId) {
        const field = data.field === 'figmaUrl' ? 'figmaUrl' : data.field === 'websiteUrl' ? 'websiteUrl' : 'form';
        setErrors({ [field]: data.error ?? 'The audit could not be started.', hint: data.hint });
        setSubmitting(false);
        return;
      }

      router.push(`/audit/${data.runId}`);
    } catch {
      setErrors({ form: 'Could not reach the UIX-Ray server. Is the dev server still running?' });
      setSubmitting(false);
    }
  }

  const onSizeKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustomSize();
    }
  };

  return (
    <form onSubmit={onSubmit} className="panel p-6 sm:p-7">
      <div className="space-y-5">
        <Field
          label="Figma design URL"
          optional
          error={errors.figmaUrl}
          hint={<span className="font-mono">figma.com/design/…</span>}
        >
          {(id) => (
            <Input
              id={id}
              name="figmaUrl"
              value={figmaUrl}
              invalid={Boolean(errors.figmaUrl)}
              onChange={(e) => {
                setFigmaUrl(e.target.value);
                setErrors((prev) => ({ ...prev, figmaUrl: undefined }));
              }}
              placeholder="https://www.figma.com/design/aBc123/Marketing-Site?node-id=12-345"
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-[13px]"
            />
          )}
        </Field>

        <p className="-mt-2 text-[12px] leading-relaxed text-faint">
          Link a specific frame (open it in Figma and copy the link) so UIX-Ray audits exactly the screen you mean.
          Leave this empty to run responsive testing on its own.
        </p>

        <Field label="Website URL" error={errors.websiteUrl}>
          {(id) => (
            <Input
              id={id}
              name="websiteUrl"
              value={websiteUrl}
              invalid={Boolean(errors.websiteUrl)}
              onChange={(e) => {
                setWebsiteUrl(e.target.value);
                setErrors((prev) => ({ ...prev, websiteUrl: undefined }));
              }}
              placeholder="https://example.com"
              autoComplete="url"
              spellCheck={false}
              className="font-mono text-[13px]"
            />
          )}
        </Field>

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[13px] font-medium text-ink">Viewports</span>
            {errors.viewportGroups && <span className="text-[12px] text-fail">{errors.viewportGroups}</span>}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {VIEWPORT_GROUPS.map((group) => (
              <CheckCard
                key={group.id}
                active={groups.includes(group.id)}
                label={group.label}
                hint={group.hint}
                onClick={() => toggleGroup(group.id)}
              />
            ))}
          </div>

          <div className="mt-2 rounded-lg border border-line bg-raised/60 p-3">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-[12.5px] font-medium text-ink">Custom sizes</span>
              <span className="text-[11px] text-faint">Any exact width × height to check</span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                aria-label="Custom viewport width in pixels"
                inputMode="numeric"
                value={customWidth}
                onChange={(e) => {
                  setCustomWidth(e.target.value.replace(/[^0-9]/g, ''));
                  setErrors((prev) => ({ ...prev, custom: undefined }));
                }}
                onKeyDown={onSizeKey}
                placeholder="Width"
                className="min-w-0 font-mono text-[13px]"
              />
              <span aria-hidden className="text-faint">
                ×
              </span>
              <Input
                aria-label="Custom viewport height in pixels"
                inputMode="numeric"
                value={customHeight}
                onChange={(e) => {
                  setCustomHeight(e.target.value.replace(/[^0-9]/g, ''));
                  setErrors((prev) => ({ ...prev, custom: undefined }));
                }}
                onKeyDown={onSizeKey}
                placeholder="Height"
                className="min-w-0 font-mono text-[13px]"
              />
              <Button type="button" variant="outline" onClick={addCustomSize} className="shrink-0">
                Add
              </Button>
            </div>
            {errors.custom && <p className="mt-1.5 text-[12px] text-fail">{errors.custom}</p>}
            {customSizes.length > 0 && (
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {customSizes.map((size) => (
                  <li
                    key={`${size.width}x${size.height}`}
                    className="flex items-center gap-1 rounded-md border border-brand/40 bg-brand/8 py-0.5 pl-2 pr-0.5 font-mono text-[11.5px] text-ink"
                  >
                    {size.width} × {size.height}
                    <button
                      type="button"
                      aria-label={`Remove ${size.width} × ${size.height}`}
                      onClick={() => removeCustomSize(size)}
                      className="rounded px-1.5 text-faint transition-colors hover:bg-overlay hover:text-ink"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-[13px] font-medium text-ink">Browsers</span>
            {errors.browsers ? (
              <span className="text-[12px] text-fail">{errors.browsers}</span>
            ) : (
              <span className="text-[11px] text-faint">Pick 2 or more to catch cross-browser differences</span>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {BROWSERS.map((browser) => (
              <CheckCard
                key={browser.id}
                active={browsers.includes(browser.id)}
                label={browser.label}
                hint={browser.hint}
                onClick={() => toggleBrowser(browser.id)}
              />
            ))}
          </div>
        </div>

        {!hasServerToken && (
          <div className="rounded-lg border border-line bg-raised/60 p-3">
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="text-[12.5px] font-medium text-ink">Figma access token</span>
              <span className="text-[11px] text-faint">{showToken ? 'Hide' : 'Add token'}</span>
            </button>
            {showToken ? (
              <div className="mt-2.5 space-y-2">
                <Input
                  type="password"
                  value={figmaToken}
                  onChange={(e) => setFigmaToken(e.target.value)}
                  placeholder="figd_…"
                  autoComplete="off"
                  className="font-mono text-[13px]"
                />
                <p className="text-[11.5px] leading-relaxed text-faint">
                  Used for this audit only and never stored. Set <code className="font-mono text-muted">FIGMA_TOKEN</code>{' '}
                  in <code className="font-mono text-muted">.env.local</code> to skip this step.
                </p>
              </div>
            ) : (
              <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
                No <code className="font-mono text-muted">FIGMA_TOKEN</code> is configured on the server. Add one here to
                enable the Figma comparison.
              </p>
            )}
          </div>
        )}

        {errors.form && (
          <div role="alert" className="rounded-lg border border-fail/30 bg-fail/8 p-3">
            <p className="text-[13px] text-fail">{errors.form}</p>
            {errors.hint && <p className="mt-1 text-[12px] text-muted">{errors.hint}</p>}
          </div>
        )}
        {errors.hint && !errors.form && <p className="text-[12px] text-muted">{errors.hint}</p>}

        <Button type="submit" size="lg" disabled={submitting} className="w-full">
          {submitting ? 'Starting audit…' : 'Run UI Audit'}
        </Button>

        <p className="text-center text-[11.5px] leading-relaxed text-faint">
          {pageLoads > 0 ? (
            <>
              <span className="tabular font-mono text-muted">{pageLoads}</span> page load{pageLoads === 1 ? '' : 's'} ·{' '}
              {viewportCount} viewport{viewportCount === 1 ? '' : 's'} × {browserCount} browser
              {browserCount === 1 ? '' : 's'}. Expect about {estimateMinutes(pageLoads)}.
            </>
          ) : (
            'Select a viewport group or add a custom size.'
          )}
        </p>
      </div>
    </form>
  );
}

function CheckCard({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={active}
      onClick={onClick}
      className={clsx(
        'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all',
        active
          ? 'border-brand/50 bg-brand/8 shadow-[inset_0_0_0_1px_rgba(79,70,229,0.14)]'
          : 'border-line bg-raised hover:border-line-strong',
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold transition-colors',
          active ? 'border-brand bg-brand text-on-brand' : 'border-line-strong text-transparent',
        )}
      >
        ✓
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        <span className="block font-mono text-[11px] text-faint">{hint}</span>
      </span>
    </button>
  );
}

/** Rough wall-clock estimate: a page load with settle, extraction and evidence takes ~6–15s. */
function estimateMinutes(pageLoads: number): string {
  const low = (pageLoads * 6) / 60;
  const high = (pageLoads * 15) / 60;
  if (high < 1.5) return `${Math.max(20, Math.round(low * 60))}–${Math.round(high * 60)} seconds`;
  return `${Math.max(1, Math.round(low))}–${Math.round(high)} minutes`;
}
