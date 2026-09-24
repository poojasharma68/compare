import { readEvidence } from '@/lib/report/evidenceStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string; shotId: string }> },
): Promise<Response> {
  const { runId, shotId } = await params;
  const image = await readEvidence(runId, shotId);

  if (!image) {
    return new Response('Evidence not found', { status: 404 });
  }

  return new Response(new Uint8Array(image), {
    headers: {
      'Content-Type': 'image/png',
      // Evidence is immutable for the life of a run.
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
