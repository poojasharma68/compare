import { EventEmitter } from 'node:events';
import { AUDIT_STEPS, type AuditStep, type AuditStepId, type RunState, type StepStatus } from '@/lib/types/run';
import { createRunId } from '@/lib/utils/id';
import { viewportsForGroups } from '@/lib/config/viewports';

const STEP_LABELS: Record<AuditStepId, string> = {
  preparing: 'Preparing test',
  'figma-fetch': 'Fetching Figma design',
  'figma-parse': 'Analyzing Figma structure',
  'browser-launch': 'Launching browser',
  'analyze-desktop': 'Analyzing desktop',
  'analyze-tablet': 'Analyzing tablet',
  'analyze-mobile': 'Analyzing mobile',
  matching: 'Matching design to DOM',
  'ui-comparison': 'Running UI comparison',
  'responsive-tests': 'Running responsive tests',
  'cross-browser': 'Comparing browsers',
  report: 'Generating report',
};

/** Relative cost of each step, used to drive the progress bar. */
const STEP_WEIGHT: Record<AuditStepId, number> = {
  preparing: 2,
  'figma-fetch': 10,
  'figma-parse': 5,
  'browser-launch': 5,
  'analyze-desktop': 22,
  'analyze-tablet': 15,
  'analyze-mobile': 22,
  matching: 6,
  'ui-comparison': 6,
  'responsive-tests': 5,
  'cross-browser': 4,
  report: 2,
};

const RUN_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_RUNS = 40;

interface StoredRun {
  state: RunState;
  emitter: EventEmitter;
}

/**
 * In-memory run registry. Deliberately simple for the MVP — the interface is
 * narrow enough that swapping it for Redis or a database later is a
 * self-contained change.
 */
const globalScope = globalThis as unknown as { __uixrayRuns?: Map<string, StoredRun> };
const runs: Map<string, StoredRun> = globalScope.__uixrayRuns ?? (globalScope.__uixrayRuns = new Map());

export function createRun(input: RunState['input']): RunState {
  pruneRuns();

  const state: RunState = {
    id: createRunId(),
    status: 'queued',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    progress: 0,
    steps: buildSteps(input),
    input,
  };

  const emitter = new EventEmitter();
  // Many SSE clients can watch one run (multiple tabs); do not warn about it.
  emitter.setMaxListeners(50);
  runs.set(state.id, { state, emitter });
  return state;
}

function buildSteps(input: RunState['input']): AuditStep[] {
  // Custom sizes fall into a group by width, so a run of only custom sizes
  // still shows the analysis steps it will actually go through.
  const groups = new Set(viewportsForGroups(input.viewportGroups, input.customViewports).map((v) => v.group));
  return AUDIT_STEPS.filter((id) => {
    if (id === 'cross-browser') return input.browsers.length > 1;
    if ((id === 'figma-fetch' || id === 'figma-parse') && !input.figmaUrl) return false;
    if (id === 'matching' || id === 'ui-comparison') return Boolean(input.figmaUrl);
    if (id === 'analyze-desktop') return groups.has('desktop');
    if (id === 'analyze-tablet') return groups.has('tablet');
    if (id === 'analyze-mobile') return groups.has('mobile');
    return true;
  }).map((id) => ({ id, label: STEP_LABELS[id], status: 'pending' as StepStatus }));
}

export function getRun(id: string): RunState | null {
  return runs.get(id)?.state ?? null;
}

export function updateRun(id: string, mutate: (state: RunState) => void): RunState | null {
  const entry = runs.get(id);
  if (!entry) return null;

  mutate(entry.state);
  entry.state.updatedAt = Date.now();
  entry.state.progress = computeProgress(entry.state);

  entry.emitter.emit('change', entry.state);
  return entry.state;
}

export function setStep(
  id: string,
  stepId: AuditStepId,
  status: StepStatus,
  detail?: string,
): void {
  updateRun(id, (state) => {
    const step = state.steps.find((s) => s.id === stepId);
    if (!step) return;
    step.status = status;
    if (detail !== undefined) step.detail = detail;
    if (status === 'active' && !step.startedAt) step.startedAt = Date.now();
    if (status === 'done' || status === 'failed' || status === 'skipped') step.finishedAt = Date.now();
  });
}

export function setStepDetail(id: string, stepId: AuditStepId, detail: string): void {
  updateRun(id, (state) => {
    const step = state.steps.find((s) => s.id === stepId);
    if (step) step.detail = detail;
  });
}

function computeProgress(state: RunState): number {
  if (state.status === 'completed') return 100;
  const total = state.steps.reduce((sum, s) => sum + (STEP_WEIGHT[s.id] ?? 1), 0);
  if (total === 0) return 0;
  const done = state.steps.reduce((sum, s) => {
    const weight = STEP_WEIGHT[s.id] ?? 1;
    if (s.status === 'done' || s.status === 'skipped') return sum + weight;
    if (s.status === 'active') return sum + weight * 0.4;
    return sum;
  }, 0);
  return Math.min(99, Math.round((done / total) * 100));
}

/** Subscribes to run updates. Returns an unsubscribe function. */
export function subscribeToRun(id: string, listener: (state: RunState) => void): (() => void) | null {
  const entry = runs.get(id);
  if (!entry) return null;
  entry.emitter.on('change', listener);
  return () => entry.emitter.off('change', listener);
}

function pruneRuns(): void {
  const now = Date.now();
  for (const [id, entry] of runs) {
    if (now - entry.state.updatedAt > RUN_TTL_MS) runs.delete(id);
  }
  if (runs.size <= MAX_RUNS) return;
  const ordered = [...runs.entries()].sort((a, b) => a[1].state.updatedAt - b[1].state.updatedAt);
  for (const [id] of ordered.slice(0, runs.size - MAX_RUNS)) runs.delete(id);
}
