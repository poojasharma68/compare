import { RunProgress } from '@/components/audit/RunProgress';

export const dynamic = 'force-dynamic';

export default async function AuditPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <RunProgress runId={runId} />;
}
