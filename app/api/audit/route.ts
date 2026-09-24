import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createRun } from '@/lib/store/runStore';
import { runAudit } from '@/lib/runner/auditRunner';
import { parseFigmaUrl } from '@/lib/figma/figmaUrl';
import { normalizeWebsiteUrl } from '@/lib/utils/url';
import { AuditError } from '@/lib/utils/errors';
import { BROWSER_NAMES } from '@/lib/config/browsers';
import { CUSTOM_VIEWPORT_LIMITS } from '@/lib/config/viewports';

// Playwright needs the Node runtime, and audits outlive a short serverless slot.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const L = CUSTOM_VIEWPORT_LIMITS;

const CustomViewportSchema = z.object({
  width: z
    .number()
    .int('Custom widths must be whole pixels.')
    .min(L.minWidth, `Custom widths must be at least ${L.minWidth}px.`)
    .max(L.maxWidth, `Custom widths must be at most ${L.maxWidth}px.`),
  height: z
    .number()
    .int('Custom heights must be whole pixels.')
    .min(L.minHeight, `Custom heights must be at least ${L.minHeight}px.`)
    .max(L.maxHeight, `Custom heights must be at most ${L.maxHeight}px.`),
});

const RequestSchema = z
  .object({
    figmaUrl: z.string().trim().max(2000).optional().nullable(),
    websiteUrl: z.string().trim().min(1, 'A website URL is required.').max(2000),
    viewportGroups: z.array(z.enum(['mobile', 'tablet', 'desktop'])).default([]),
    customViewports: z
      .array(CustomViewportSchema)
      .max(L.max, `Add at most ${L.max} custom sizes.`)
      .default([]),
    browsers: z
      .array(z.enum(BROWSER_NAMES))
      .min(1, 'Select at least one browser.')
      .default(['chromium']),
    figmaToken: z.string().trim().max(200).optional().nullable(),
    tolerances: z.record(z.string(), z.number()).optional(),
  })
  .refine((body) => body.viewportGroups.length > 0 || body.customViewports.length > 0, {
    message: 'Select at least one viewport group or add a custom size.',
    path: ['viewportGroups'],
  });

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.', field: parsed.error.issues[0]?.path.join('.') },
      { status: 400 },
    );
  }

  const { websiteUrl, viewportGroups, customViewports, figmaToken, tolerances } = parsed.data;
  const browsers = [...new Set(parsed.data.browsers)];
  const figmaUrl = parsed.data.figmaUrl?.trim() || null;

  // Validate both URLs up front so the user gets an inline field error rather
  // than a run that fails three seconds later.
  try {
    normalizeWebsiteUrl(websiteUrl);
    if (figmaUrl) parseFigmaUrl(figmaUrl);
  } catch (err) {
    if (err instanceof AuditError) {
      return NextResponse.json(
        {
          error: err.message,
          hint: err.hint,
          code: err.code,
          field: err.code === 'INVALID_FIGMA_URL' ? 'figmaUrl' : 'websiteUrl',
        },
        { status: 400 },
      );
    }
    throw err;
  }

  const run = createRun({ figmaUrl, websiteUrl, viewportGroups, browsers, customViewports });

  // Fire and forget: the client follows progress over SSE.
  void runAudit({
    runId: run.id,
    figmaUrl,
    websiteUrl,
    viewportGroups,
    browsers,
    customViewports,
    figmaToken: figmaToken ?? null,
    tolerances,
  });

  return NextResponse.json({ runId: run.id, status: run.status }, { status: 202 });
}
