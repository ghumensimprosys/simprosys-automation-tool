import { NextRequest, NextResponse } from 'next/server';
import { getJob, getResult } from '@/lib/auditJobManager';
import { loadResult } from '@/lib/auditHistory';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;

  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  if (job.status === 'error') {
    return NextResponse.json({ error: job.error || 'Audit failed', status: 'error' }, { status: 500 });
  }

  if (job.status !== 'complete') {
    return NextResponse.json({ status: job.status, progress: job.totalProgress }, { status: 202 });
  }

  // Try in-memory first (faster), fall back to disk
  const result = getResult(jobId) ?? loadResult(jobId);
  if (!result) {
    return NextResponse.json({ error: 'Result not found — it may have expired. Re-run the audit.' }, { status: 404 });
  }

  return NextResponse.json(result);
}
