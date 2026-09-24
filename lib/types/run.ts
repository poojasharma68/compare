import type { AuditReport } from './report';

export const AUDIT_STEPS = [
  'preparing',
  'figma-fetch',
  'figma-parse',
  'browser-launch',
  'analyze-desktop',
  'analyze-tablet',
  'analyze-mobile',
  'matching',
  'ui-comparison',
  'responsive-tests',
  'cross-browser',
  'report',
] as const;

export type AuditStepId = (typeof AUDIT_STEPS)[number];

export type StepStatus = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

export interface AuditStep {
  id: AuditStepId;
  label: string;
  status: StepStatus;
  detail?: string;
  startedAt?: number;
  finishedAt?: number;
}

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface RunState {
  id: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  steps: AuditStep[];
  /** 0–100 coarse progress for the progress bar. */
  progress: number;
  error?: { message: string; code?: string; hint?: string };
  report?: AuditReport;
  input: {
    figmaUrl: string | null;
    websiteUrl: string;
    viewportGroups: string[];
    browsers: Array<'chromium' | 'firefox' | 'webkit'>;
    customViewports: Array<{ width: number; height: number }>;
  };
}

/** Snapshot pushed to the client over SSE. */
export interface RunEvent {
  type: 'state' | 'done' | 'error';
  state: RunState;
}
