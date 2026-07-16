import { NextRequest, NextResponse } from 'next/server';
import type { AuditConfig, CrawlMode, AuditCategory } from '@/types/audit';
import { createJob } from '@/lib/auditJobManager';
import { runAuditJob } from '@/lib/auditPipeline';
import { normalizeUrl } from '@/lib/urlUtils';

const CRAWL_MODE_DEFAULTS: Record<CrawlMode, number> = {
  single:    1,
  topPages:  10,
  fullCrawl: 50,
};

const ALL_CATEGORIES: AuditCategory[] = [
  'seo', 'accessibility', 'performance', 'security',
  'uiux', 'content', 'tech', 'functional', 'visual',
];

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawUrl = ((body.url as string) || '').trim();
  if (!rawUrl) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  const normalised = normalizeUrl(rawUrl);
  if (!normalised) {
    return NextResponse.json({ error: 'Invalid URL — must be http:// or https://' }, { status: 400 });
  }

  const crawlMode: CrawlMode = (['single', 'topPages', 'fullCrawl'] as CrawlMode[]).includes(
    body.crawlMode as CrawlMode,
  )
    ? (body.crawlMode as CrawlMode)
    : 'single';

  const maxPages = typeof body.maxPages === 'number' && body.maxPages > 0
    ? Math.min(body.maxPages, 200)
    : CRAWL_MODE_DEFAULTS[crawlMode];

  const categories: AuditCategory[] = Array.isArray(body.categories) && body.categories.length > 0
    ? (body.categories as AuditCategory[]).filter(c => ALL_CATEGORIES.includes(c))
    : ALL_CATEGORIES;

  const crawlDelayMs = typeof body.crawlDelayMs === 'number' && body.crawlDelayMs >= 0
    ? body.crawlDelayMs
    : 500;

  const config: AuditConfig = {
    url: normalised,
    crawlMode,
    maxPages,
    crawlDelayMs,
    categories,
  };

  const job = createJob(config);

  // Fire and forget — audit runs in the background
  runAuditJob(job).catch(err => {
    console.error(`[audit] job ${job.jobId} crashed outside pipeline:`, err);
  });

  return NextResponse.json({ jobId: job.jobId, status: job.status });
}
