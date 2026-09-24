import Link from 'next/link';
import { ReportView } from '@/components/report/ReportView';
import { getRun } from '@/lib/store/runStore';
import { Button, Logo } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

export default async function ReportPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = getRun(runId);

  if (!run) return <Missing title="Audit not found" body="Runs are held in memory and cleared when the dev server restarts. Start a new audit to generate a fresh report." />;

  if (run.status === 'failed') {
    return (
      <Missing
        title="This audit failed"
        body={run.error?.hint ? `${run.error.message} ${run.error.hint}` : (run.error?.message ?? 'The audit did not complete.')}
      />
    );
  }

  if (!run.report) {
    return (
      <Missing
        title="This audit is still running"
        body="The report is generated once every viewport has been analysed."
        action={{ href: `/audit/${runId}`, label: 'Follow progress' }}
      />
    );
  }

  return <ReportView report={run.report} />;
}

function Missing({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-5 py-16">
      <div className="panel p-7">
        <Logo />
        <h1 className="mt-4 text-lg font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{body}</p>
        <div className="mt-5 flex gap-2">
          {action && (
            <Link href={action.href}>
              <Button size="sm">{action.label}</Button>
            </Link>
          )}
          <Link href="/">
            <Button variant="outline" size="sm">
              Start a new audit
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
