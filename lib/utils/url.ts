import { AuditError } from './errors';

/**
 * Normalizes a user-typed website URL. Accepts bare hosts, adds https:// and
 * rejects anything that is not an HTTP(S) address.
 */
export function normalizeWebsiteUrl(input: string): string {
  const raw = input.trim();
  if (!raw) {
    throw new AuditError('INVALID_WEBSITE_URL', 'Website URL is empty.', {
      hint: 'Enter the page you want audited, for example https://example.com/pricing',
    });
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new AuditError('INVALID_WEBSITE_URL', `"${input}" is not a valid URL.`, {
      hint: 'Include the full address, for example https://example.com',
    });
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AuditError('INVALID_WEBSITE_URL', `Unsupported protocol "${url.protocol}".`, {
      hint: 'Only http:// and https:// pages can be audited.',
    });
  }

  if (!url.hostname || !url.hostname.includes('.')) {
    // Single-label hosts are still valid for local development.
    if (url.hostname !== 'localhost' && !/^\d+(\.\d+){3}$/.test(url.hostname)) {
      throw new AuditError('INVALID_WEBSITE_URL', `"${url.hostname}" is not a resolvable host name.`, {
        hint: 'Use a full domain such as example.com, or localhost for a local dev server.',
      });
    }
  }

  return url.toString();
}

export function isValidWebsiteUrl(input: string): boolean {
  try {
    normalizeWebsiteUrl(input);
    return true;
  } catch {
    return false;
  }
}

/** Short display form: host plus path, without protocol noise. */
export function displayUrl(input: string, maxLength = 48): string {
  try {
    const url = new URL(input);
    const text = `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  } catch {
    return input;
  }
}
