import { NextRequest } from 'next/server';
import { getJob } from '@/lib/auditJobManager';
import { createSseStream } from '@/lib/auditEventBus';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;

  const job = getJob(jobId);
  if (!job) {
    return new Response(JSON.stringify({ error: 'Job not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // If the job has already completed or errored, send a final event immediately
  if (job.status === 'complete' || job.status === 'error') {
    const event = job.status === 'complete'
      ? `data: ${JSON.stringify({ type: 'complete', healthScore: 0, grade: 'F', durationMs: 0, pagesCrawled: 0, issueCount: { critical: 0, warning: 0, info: 0 } })}\n\n`
      : `data: ${JSON.stringify({ type: 'error', message: job.error || 'Audit failed' })}\n\n`;

    return new Response(event, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  const stream = createSseStream(jobId);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Connection': 'keep-alive',
    },
  });
}
