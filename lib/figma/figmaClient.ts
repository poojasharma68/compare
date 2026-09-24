import type { FigmaFileResponse, FigmaNode, FigmaNodesResponse } from '@/lib/types/figma';
import { AuditError } from '@/lib/utils/errors';

const API_BASE = 'https://api.figma.com/v1';
const REQUEST_TIMEOUT_MS = 30_000;

export interface FigmaClientOptions {
  token: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Thin, typed wrapper over the Figma REST API. Every failure mode is mapped to
 * an AuditError with a code the UI can act on.
 */
export class FigmaClient {
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FigmaClientOptions) {
    if (!options.token) {
      throw new AuditError('FIGMA_AUTH', 'No Figma access token was provided.', {
        hint: 'Set FIGMA_TOKEN in .env.local, or paste a personal access token in the audit form.',
      });
    }
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Fetches the whole file. `depth` keeps the payload sane for large files —
   * we only need enough levels to find meaningful frames.
   */
  async getFile(fileKey: string, depth?: number): Promise<FigmaFileResponse> {
    const qs = depth ? `?depth=${depth}` : '';
    return this.request<FigmaFileResponse>(`/files/${encodeURIComponent(fileKey)}${qs}`, fileKey);
  }

  /** Fetches one subtree — used when the URL pins a specific frame. */
  async getNode(fileKey: string, nodeId: string): Promise<FigmaNode> {
    const res = await this.request<FigmaNodesResponse>(
      `/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}`,
      fileKey,
    );
    const entry = res.nodes?.[nodeId];
    if (!entry?.document) {
      throw new AuditError('FIGMA_FRAME_NOT_FOUND', `Frame ${nodeId} was not found in this Figma file.`, {
        hint: 'The node-id in the URL may point at a deleted layer, or belong to a different file.',
        recoverable: true,
      });
    }
    return entry.document;
  }

  private async request<T>(path: string, fileKey: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${API_BASE}${path}`, {
        headers: { 'X-Figma-Token': this.token, Accept: 'application/json' },
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      throw new AuditError(
        'FIGMA_API',
        aborted
          ? `Figma API timed out after ${Math.round(this.timeoutMs / 1000)}s.`
          : `Could not reach the Figma API: ${err instanceof Error ? err.message : String(err)}`,
        { hint: 'Check your network connection and try again.', recoverable: true, cause: err },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) throw await this.mapHttpError(response, fileKey);

    try {
      return (await response.json()) as T;
    } catch (err) {
      throw new AuditError('FIGMA_API', 'Figma returned a response that could not be parsed as JSON.', {
        recoverable: true,
        cause: err,
      });
    }
  }

  private async mapHttpError(response: Response, fileKey: string): Promise<AuditError> {
    const body = await response.text().catch(() => '');
    let detail = body.slice(0, 300);
    try {
      const parsed = JSON.parse(body) as { err?: string; message?: string };
      detail = parsed.err ?? parsed.message ?? detail;
    } catch {
      /* keep the raw snippet */
    }

    switch (response.status) {
      case 401:
      case 403: {
        // Figma returns 403 for two very different situations: a token it will
        // not accept at all, and a perfectly valid token whose scopes do not
        // cover this endpoint. Its own response names the missing scope, which
        // is far more actionable than anything we could infer, so pass it on.
        const scopeProblem = /scope/i.test(detail);
        return new AuditError(
          'FIGMA_AUTH',
          scopeProblem
            ? `Figma rejected the request: ${detail}`
            : `Figma rejected the access token (${response.status}).`,
          {
            hint: scopeProblem
              ? 'The token is valid but lacks file read access. Regenerate it in Figma with "File content" set to Read-only, then paste the new token.'
              : 'Check the token is current, and that the account it belongs to can open this file.',
            recoverable: true,
          },
        );
      }
      case 404:
        return new AuditError('FIGMA_NOT_FOUND', `Figma file "${fileKey}" was not found.`, {
          hint: 'Double-check the link, and confirm the token belongs to an account with access to that file.',
          recoverable: true,
        });
      case 429:
        return new AuditError('FIGMA_RATE_LIMIT', 'Figma API rate limit reached.', {
          hint: 'Wait a minute before running another audit against this file.',
          recoverable: true,
        });
      default:
        return new AuditError('FIGMA_API', `Figma API error ${response.status}: ${detail || response.statusText}`, {
          recoverable: true,
        });
    }
  }
}

/** Reads the server-side token, if one is configured. */
export function envFigmaToken(): string | null {
  const token = process.env.FIGMA_TOKEN ?? process.env.FIGMA_ACCESS_TOKEN;
  return token && token.trim() ? token.trim() : null;
}
