import { getRun, subscribeToRun } from '@/lib/store/runStore';
import type { RunState } from '@/lib/types/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Server-sent events carrying run state until the audit finishes. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const initial = getRun(id);

  if (!initial) {
    return new Response('event: error\ndata: {"message":"Run not found"}\n\n', {
      status: 404,
      headers: sseHeaders(),
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (state: RunState) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(state)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe?.();
        request.signal.removeEventListener('abort', finish);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      send(initial);
      if (initial.status === 'completed' || initial.status === 'failed') {
        finish();
        return;
      }

      const unsubscribe = subscribeToRun(id, (state) => {
        send(state);
        if (state.status === 'completed' || state.status === 'failed') {
          // Let the final frame flush before closing the connection.
          setTimeout(finish, 50);
        }
      });

      // Keeps proxies from dropping an otherwise idle connection.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          finish();
        }
      }, 15_000);

      request.signal.addEventListener('abort', finish);
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}

function sseHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}
