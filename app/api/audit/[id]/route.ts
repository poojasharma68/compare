import { NextResponse } from 'next/server';
import { getRun } from '@/lib/store/runStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const run = getRun(id);

  if (!run) {
    return NextResponse.json(
      { error: 'That audit was not found. Runs are kept in memory and are cleared when the server restarts.' },
      { status: 404 },
    );
  }

  return NextResponse.json(run, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
