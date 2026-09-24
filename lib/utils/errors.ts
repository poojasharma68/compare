export type AuditErrorCode =
  | 'INVALID_FIGMA_URL'
  | 'INVALID_WEBSITE_URL'
  | 'FIGMA_AUTH'
  | 'FIGMA_NOT_FOUND'
  | 'FIGMA_RATE_LIMIT'
  | 'FIGMA_API'
  | 'FIGMA_FRAME_NOT_FOUND'
  | 'FIGMA_EMPTY'
  | 'SITE_UNREACHABLE'
  | 'SITE_TIMEOUT'
  | 'BROWSER_LAUNCH'
  | 'NO_MATCHES'
  | 'NO_VIEWPORTS'
  | 'INTERNAL';

/** Error carrying a stable code plus a user-facing remediation hint. */
export class AuditError extends Error {
  readonly code: AuditErrorCode;
  readonly hint?: string;
  /** When true, the audit can continue with the other module. */
  readonly recoverable: boolean;

  constructor(code: AuditErrorCode, message: string, options?: { hint?: string; recoverable?: boolean; cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'AuditError';
    this.code = code;
    this.hint = options?.hint;
    this.recoverable = options?.recoverable ?? false;
  }
}

export function toAuditError(err: unknown, fallbackCode: AuditErrorCode = 'INTERNAL'): AuditError {
  if (err instanceof AuditError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new AuditError(fallbackCode, message, { cause: err });
}

export function describeError(err: unknown): { message: string; code?: string; hint?: string } {
  if (err instanceof AuditError) return { message: err.message, code: err.code, hint: err.hint };
  return { message: err instanceof Error ? err.message : String(err) };
}
