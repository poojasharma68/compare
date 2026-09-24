import { randomBytes } from 'node:crypto';

export function createRunId(): string {
  return `run_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

export function createShotId(prefix: string): string {
  return `${prefix}_${randomBytes(5).toString('hex')}`;
}

/** Sequential, human-referencable test ids: UI-001, RESP-014, ... */
export function makeIdFactory(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${String(++n).padStart(3, '0')}`;
}
