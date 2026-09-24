import type { FigmaUrlInfo } from '@/lib/types/figma';
import { AuditError } from '@/lib/utils/errors';

const FILE_KEY_RE = /^[A-Za-z0-9]{10,64}$/;
const PATH_RE = /\/(file|design|proto|board)\/([A-Za-z0-9]+)(?:\/([^/?#]+))?/;

/**
 * Accepts the shapes Figma actually hands out:
 *   figma.com/file/KEY/Name?node-id=1-2
 *   figma.com/design/KEY/Name?node-id=1%3A2
 *   figma.com/proto/KEY/Name?node-id=1-2
 * plus a bare file key.
 */
export function parseFigmaUrl(input: string): FigmaUrlInfo {
  const raw = input.trim();
  if (!raw) {
    throw new AuditError('INVALID_FIGMA_URL', 'Figma URL is empty.', {
      hint: 'Paste the share link from Figma (Share → Copy link).',
    });
  }

  // Bare file key.
  if (!raw.includes('/') && FILE_KEY_RE.test(raw)) {
    return { fileKey: raw, nodeId: null, fileName: null, raw };
  }

  let url: URL;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    throw new AuditError('INVALID_FIGMA_URL', `"${input}" is not a valid Figma URL.`, {
      hint: 'Expected something like https://www.figma.com/design/<key>/<name>?node-id=1-2',
    });
  }

  if (!/(^|\.)figma\.com$/i.test(url.hostname)) {
    throw new AuditError('INVALID_FIGMA_URL', `"${url.hostname}" is not a figma.com URL.`, {
      hint: 'UIX-Ray reads designs through the Figma REST API, so the link must be a figma.com link.',
    });
  }

  const match = url.pathname.match(PATH_RE);
  if (!match) {
    throw new AuditError('INVALID_FIGMA_URL', 'Could not find a file key in that Figma URL.', {
      hint: 'The link should contain /file/, /design/ or /proto/ followed by the file key.',
    });
  }

  const fileKey = match[2];
  if (!FILE_KEY_RE.test(fileKey)) {
    throw new AuditError('INVALID_FIGMA_URL', `"${fileKey}" does not look like a Figma file key.`);
  }

  return {
    fileKey,
    nodeId: normalizeNodeId(url.searchParams.get('node-id')),
    fileName: match[3] ? decodeURIComponent(match[3]).replace(/-/g, ' ') : null,
    raw,
  };
}

/** URLs encode `1:2` as `1-2`; the REST API wants the colon form back. */
export function normalizeNodeId(nodeId: string | null | undefined): string | null {
  if (!nodeId) return null;
  const decoded = decodeURIComponent(nodeId).trim();
  if (!decoded) return null;
  return decoded.replace(/-/g, ':');
}

export function isLikelyFigmaUrl(input: string): boolean {
  try {
    parseFigmaUrl(input);
    return true;
  } catch {
    return false;
  }
}
