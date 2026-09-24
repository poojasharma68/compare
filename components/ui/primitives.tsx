'use client';

import clsx from 'clsx';
import { useId, useState, type ReactNode } from 'react';

/* --------------------------------- Logo ---------------------------------- */

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={clsx('h-7 w-7', className)} aria-hidden>
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" stroke="var(--color-brand)" strokeWidth="1.5" />
      <path d="M8 8h4l4 7 4-7h4" stroke="var(--color-brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 15v9" stroke="var(--color-brand-glow)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="24" r="1.6" fill="var(--color-brand-glow)" />
    </svg>
  );
}

/* -------------------------------- Button ---------------------------------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
};

export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150',
        'disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-6 text-[15px]',
        variant === 'primary' &&
          'bg-brand text-on-brand shadow-[0_1px_2px_rgba(16,19,26,0.08),0_8px_20px_-10px_rgba(79,70,229,0.5)] hover:bg-brand-glow active:translate-y-px',
        variant === 'outline' &&
          'border border-line-strong bg-raised text-ink hover:border-brand/60 hover:bg-overlay active:translate-y-px',
        variant === 'ghost' && 'text-muted hover:bg-raised hover:text-ink',
        className,
      )}
    />
  );
}

/* --------------------------------- Field ---------------------------------- */

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  children: (id: string) => ReactNode;
}

export function Field({ label, hint, error, optional, children }: FieldProps) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {label}
          {optional && <span className="ml-1.5 text-[11px] font-normal text-faint">optional</span>}
        </label>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
      {children(id)}
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-[12px] text-fail">
          <span aria-hidden>✕</span>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={clsx(
        'h-11 w-full rounded-lg border bg-raised px-3.5 text-sm text-ink transition-colors',
        'placeholder:text-faint focus:bg-overlay',
        invalid ? 'border-fail/70' : 'border-line hover:border-line-strong focus:border-brand',
        className,
      )}
    />
  );
}

/* --------------------------------- Badge ---------------------------------- */

export type StatusTone = 'pass' | 'warn' | 'fail' | 'critical' | 'neutral' | 'info' | 'brand';

const TONE_CLASSES: Record<StatusTone, string> = {
  pass: 'bg-pass/12 text-pass border-pass/25',
  warn: 'bg-warn/12 text-warn border-warn/25',
  fail: 'bg-fail/12 text-fail border-fail/25',
  critical: 'bg-critical/15 text-critical border-critical/35',
  info: 'bg-info/12 text-info border-info/25',
  brand: 'bg-brand/12 text-brand border-brand/25',
  neutral: 'bg-raised text-muted border-line',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  mono,
}: {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4',
        mono && 'font-mono',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function statusTone(status: string): StatusTone {
  switch (status) {
    case 'PASS':
      return 'pass';
    case 'WARNING':
      return 'warn';
    case 'FAIL':
      return 'fail';
    default:
      return 'neutral';
  }
}

export function severityTone(severity: string): StatusTone {
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'major':
      return 'fail';
    case 'minor':
      return 'warn';
    default:
      return 'neutral';
  }
}

export function StatusIcon({ status, className }: { status: string; className?: string }) {
  const glyph = status === 'PASS' ? '✓' : status === 'WARNING' ? '!' : status === 'FAIL' ? '✕' : '–';
  const tone = statusTone(status);
  return (
    <span
      aria-hidden
      className={clsx(
        'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
        tone === 'pass' && 'bg-pass/15 text-pass',
        tone === 'warn' && 'bg-warn/15 text-warn',
        tone === 'fail' && 'bg-fail/15 text-fail',
        tone === 'neutral' && 'bg-raised text-faint',
        className,
      )}
    >
      {glyph}
    </span>
  );
}

/* -------------------------------- Tooltip --------------------------------- */

export function InfoTooltip({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={title}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-line-strong text-[10px] font-semibold text-faint transition-colors hover:border-brand hover:text-brand"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-6 z-50 w-80 -translate-x-1/2 rounded-lg border border-line-strong bg-overlay p-3 text-[12px] leading-relaxed text-muted shadow-2xl"
        >
          <span className="mb-1 block font-medium text-ink">{title}</span>
          {children}
        </span>
      )}
    </span>
  );
}

/* ------------------------------- ScoreRing -------------------------------- */

export function ScoreRing({
  value,
  size = 68,
  label,
}: {
  value: number;
  size?: number;
  label?: string;
}) {
  const radius = size / 2 - 5;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = circumference * (1 - clamped / 100);
  const color = clamped >= 90 ? 'var(--color-pass)' : clamped >= 70 ? 'var(--color-warn)' : 'var(--color-fail)';

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-line)" strokeWidth="5" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-lg font-semibold leading-none text-ink">{Math.round(clamped)}</span>
        {label && <span className="mt-0.5 text-[9px] uppercase tracking-wider text-faint">{label}</span>}
      </div>
    </div>
  );
}

/* --------------------------------- Meter ---------------------------------- */

export function Meter({ value, tone }: { value: number; tone?: StatusTone }) {
  const clamped = Math.max(0, Math.min(100, value));
  const resolved = tone ?? (clamped >= 90 ? 'pass' : clamped >= 70 ? 'warn' : 'fail');
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
      <div
        className={clsx(
          'h-full rounded-full transition-[width] duration-700 ease-out',
          resolved === 'pass' && 'bg-pass',
          resolved === 'warn' && 'bg-warn',
          resolved === 'fail' && 'bg-fail',
          resolved === 'brand' && 'bg-brand',
          resolved === 'neutral' && 'bg-line-strong',
          resolved === 'info' && 'bg-info',
          resolved === 'critical' && 'bg-critical',
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/* --------------------------------- Empty ---------------------------------- */

export function EmptyState({ title, body, icon }: { title: string; body: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-6 py-12 text-center">
      {icon && <div className="text-2xl opacity-40">{icon}</div>}
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="max-w-md text-[13px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}

/* ------------------------------- Section ---------------------------------- */

export function SectionHeading({
  title,
  subtitle,
  right,
  id,
}: {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id={id} className="text-[15px] font-semibold tracking-tight text-ink">
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
