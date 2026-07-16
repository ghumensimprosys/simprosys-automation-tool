/**
 * src/lib/auditJobManager.ts
 *
 * In-memory job store for audit jobs. Uses the globalThis singleton pattern
 * so the Map survives Next.js HMR hot-reloads in development.
 *
 * Stores:
 *   AuditJob   — lightweight status/progress object (always kept)
 *   SiteAuditResult — full result (added when job completes, trimmed after TTL)
 *
 * TTL: completed job results are evicted after RESULT_TTL_MS to prevent
 * unbounded memory growth in long-running dev sessions.
 */

import type { AuditJob, AuditJobStatus, AuditConfig, SiteAuditResult } from '@/types/audit';
import { loadResult } from '@/lib/auditHistory';

const JOB_TTL_MS    = 1000 * 60 * 60 * 2;  // 2 hours — keep completed jobs
const RESULT_TTL_MS = 1000 * 60 * 30;       // 30 min — then evict full result to save RAM

// ─── HMR-safe singletons ──────────────────────────────────────────────────────

const g = globalThis as Record<string, unknown>;

if (!g.__auditJobs)    g.__auditJobs    = new Map<string, AuditJob>();
if (!g.__auditResults) g.__auditResults = new Map<string, SiteAuditResult>();
if (!g.__auditExpiry)  g.__auditExpiry  = new Map<string, number>();

const jobs    = g.__auditJobs    as Map<string, AuditJob>;
const results = g.__auditResults as Map<string, SiteAuditResult>;
const expiry  = g.__auditExpiry  as Map<string, number>;

// ─── ID generation ────────────────────────────────────────────────────────────

let counter = 0;

export function generateJobId(): string {
  counter = (counter + 1) % 1_000_000;
  return `audit_${Date.now()}_${counter.toString().padStart(6, '0')}`;
}

// ─── Job CRUD ─────────────────────────────────────────────────────────────────

export function createJob(config: AuditConfig): AuditJob {
  const jobId = generateJobId();
  const job: AuditJob = {
    jobId,
    config,
    status: 'queued',
    startedAt: Date.now(),
    currentPhase: 'queued',
    currentPhaseLabel: 'Queued',
    totalProgress: 0,
    crawlProgress: {
      discovered: 0,
      crawled: 0,
      queued: 0,
      errored: 0,
      currentUrl: config.url,
    },
  };
  jobs.set(jobId, job);
  expiry.set(jobId, Date.now() + JOB_TTL_MS);
  return job;
}

export function getJob(jobId: string): AuditJob | undefined {
  evictStale();
  const inMem = jobs.get(jobId);
  if (inMem) return inMem;

  // After a server restart the in-memory map is empty, but completed jobs were
  // persisted to disk by auditHistory.ts. Reconstruct a minimal job record so
  // the result API and history tab still work without re-running the audit.
  const diskResult = loadResult(jobId);
  if (!diskResult) return undefined;
  return {
    jobId,
    config: diskResult.config,
    status: 'complete',
    startedAt: diskResult.auditedAt - diskResult.durationMs,
    completedAt: diskResult.auditedAt,
    currentPhase: 'complete',
    currentPhaseLabel: 'Complete',
    totalProgress: 100,
    crawlProgress: {
      discovered: diskResult.pages.length,
      crawled: diskResult.pages.length,
      queued: 0,
      errored: 0,
      currentUrl: diskResult.config.url,
    },
  };
}

export function updateJob(jobId: string, patch: Partial<AuditJob>): void {
  const job = jobs.get(jobId);
  if (!job) return;
  Object.assign(job, patch);
  // Refresh TTL on activity
  expiry.set(jobId, Date.now() + JOB_TTL_MS);
}

export function setJobStatus(
  jobId: string,
  status: AuditJobStatus,
  phase: string,
  phaseLabel: string,
  progress: number,
): void {
  updateJob(jobId, {
    status,
    currentPhase: phase,
    currentPhaseLabel: phaseLabel,
    totalProgress: progress,
    ...(status === 'complete' || status === 'error' ? { completedAt: Date.now() } : {}),
  });
}

export function failJob(jobId: string, message: string): void {
  updateJob(jobId, {
    status: 'error',
    currentPhase: 'error',
    currentPhaseLabel: 'Error',
    error: message,
    completedAt: Date.now(),
  });
}

// ─── Result storage ───────────────────────────────────────────────────────────

export function storeResult(jobId: string, result: SiteAuditResult): void {
  results.set(jobId, result);
  // Evict full result sooner than the job record itself
  setTimeout(() => results.delete(jobId), RESULT_TTL_MS);
}

export function getResult(jobId: string): SiteAuditResult | undefined {
  return results.get(jobId);
}

// ─── History listing ──────────────────────────────────────────────────────────

/** All jobs ordered newest-first. */
export function listJobs(): AuditJob[] {
  evictStale();
  return Array.from(jobs.values()).sort((a, b) => b.startedAt - a.startedAt);
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

function evictStale(): void {
  const now = Date.now();
  for (const [id, exp] of expiry) {
    if (now > exp) {
      jobs.delete(id);
      results.delete(id);
      expiry.delete(id);
    }
  }
}
