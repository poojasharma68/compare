import type { DesignTree, FigmaNode } from '@/lib/types/figma';
import { AuditError } from '@/lib/utils/errors';
import { FigmaClient } from './figmaClient';
import { buildDesignTree } from './designNormalizer';
import { collectFrameCandidates, selectRootFrame } from './figmaParser';
import { parseFigmaUrl } from './figmaUrl';

/** Depth 3 = pages + top-level frames + one level of children: enough signal
 *  to rank frames without downloading an entire design system. */
const DISCOVERY_DEPTH = 3;

export interface LoadDesignResult {
  tree: DesignTree;
  warnings: string[];
}

/**
 * Turns a Figma URL into a normalized design tree:
 * discover frames → choose the audited frame → fetch it in full → normalize.
 */
export async function loadDesignTree(
  figmaUrl: string,
  token: string,
  options: { onProgress?: (detail: string) => void } = {},
): Promise<LoadDesignResult> {
  const warnings: string[] = [];
  const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);
  const client = new FigmaClient({ token });

  options.onProgress?.('Reading file structure');
  const file = await client.getFile(fileKey, DISCOVERY_DEPTH);
  const candidates = collectFrameCandidates(file.document);
  const availableFrames = candidates.slice(0, 40).map((c) => ({
    id: c.id,
    name: c.name,
    width: c.width,
    height: c.height,
  }));

  let targetId: string | null = nodeId;

  if (targetId) {
    // The pinned node may be a page rather than a frame; fall back to the best
    // frame inside it instead of failing the whole module.
    const pinned = candidates.find((c) => c.id === targetId);
    if (!pinned && !availableFrames.some((f) => f.id === targetId)) {
      options.onProgress?.(`Resolving pinned node ${targetId}`);
    }
  } else {
    const best = selectRootFrame(file.document);
    if (!best) {
      throw new AuditError('FIGMA_EMPTY', `No usable frame was found in "${file.name}".`, {
        hint: 'Open the frame you want audited in Figma and copy its link so it carries a node-id.',
        recoverable: true,
      });
    }
    targetId = best.id;
    warnings.push(
      `No frame was pinned in the Figma URL — audited "${best.name}" (${best.width}×${best.height}), the closest match to a web screen.`,
    );
  }

  options.onProgress?.('Downloading frame');
  let root: FigmaNode = await client.getNode(fileKey, targetId);

  if (root.type === 'CANVAS' || root.type === 'DOCUMENT') {
    const inner = selectRootFrame(root.type === 'DOCUMENT' ? root : { ...root, children: [root] });
    if (!inner) {
      throw new AuditError('FIGMA_FRAME_NOT_FOUND', 'The linked Figma node is a page with no frames in it.', {
        hint: 'Link a specific frame instead of a page.',
        recoverable: true,
      });
    }
    warnings.push(`The Figma link pointed at a page — audited the "${inner.name}" frame inside it.`);
    root = await client.getNode(fileKey, inner.id);
  }

  if (!root.absoluteBoundingBox) {
    throw new AuditError('FIGMA_FRAME_NOT_FOUND', `Figma node "${root.name}" has no geometry to compare against.`, {
      hint: 'Pick a FRAME or COMPONENT — vectors and pages carry no layout box.',
      recoverable: true,
    });
  }

  options.onProgress?.('Normalizing design tree');
  const tree = buildDesignTree(root, {
    fileKey,
    fileName: file.name ?? 'Figma file',
    availableFrames,
  });

  if (tree.nodes.length <= 1) {
    throw new AuditError('FIGMA_EMPTY', `Frame "${tree.rootName}" contains no visible layers.`, {
      hint: 'Make sure the frame is not hidden and actually contains content.',
      recoverable: true,
    });
  }

  return { tree, warnings };
}
