import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = process.env.UIXRAY_DATA_DIR
  ? path.resolve(process.env.UIXRAY_DATA_DIR)
  : path.join(process.cwd(), '.uixray');

const RUNS_DIR = path.join(DATA_DIR, 'runs');
const MAX_RUN_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_RUNS_KEPT = 25;

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

function runDir(runId: string): string {
  if (!SAFE_ID.test(runId)) throw new Error(`Unsafe run id: ${runId}`);
  return path.join(RUNS_DIR, runId);
}

export async function saveEvidence(runId: string, shotId: string, data: Buffer): Promise<void> {
  if (!SAFE_ID.test(shotId)) throw new Error(`Unsafe evidence id: ${shotId}`);
  const dir = runDir(runId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${shotId}.png`), data);
}

export async function readEvidence(runId: string, shotId: string): Promise<Buffer | null> {
  if (!SAFE_ID.test(runId) || !SAFE_ID.test(shotId)) return null;
  try {
    return await readFile(path.join(runDir(runId), `${shotId}.png`));
  } catch {
    return null;
  }
}

/**
 * Evidence is disposable: drop runs that are old or beyond the retention cap.
 * Called opportunistically at the start of each audit, never on a hot path.
 */
export async function pruneEvidence(): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(RUNS_DIR);
  } catch {
    return;
  }

  const stats = await Promise.all(
    entries.map(async (name) => {
      try {
        const info = await stat(path.join(RUNS_DIR, name));
        return { name, mtime: info.mtimeMs };
      } catch {
        return null;
      }
    }),
  );

  const present = stats.filter((s): s is { name: string; mtime: number } => s !== null);
  present.sort((a, b) => b.mtime - a.mtime);

  const now = Date.now();
  const doomed = present.filter((entry, i) => i >= MAX_RUNS_KEPT || now - entry.mtime > MAX_RUN_AGE_MS);

  await Promise.all(
    doomed.map((entry) => rm(path.join(RUNS_DIR, entry.name), { recursive: true, force: true }).catch(() => undefined)),
  );
}

export function evidenceUrl(runId: string, shotId: string): string {
  return `/api/evidence/${encodeURIComponent(runId)}/${encodeURIComponent(shotId)}`;
}
