/**
 * src/lib/auditHistory.ts
 *
 * Persistent audit history stored as NDJSON in the local filesystem.
 * Each completed audit appends one index entry (AuditIndexEntry) to
 * audits/history.ndjson. Full results are stored as individual JSON files
 * under audits/<jobId>.json.
 *
 * This is local-first: no database, no cloud, no external dependencies.
 * The audits/ directory lives at the project root (process.cwd()).
 */

import fs from 'fs';
import path from 'path';
import type { AuditIndexEntry, SiteAuditResult } from '@/types/audit';

const AUDITS_DIR   = path.join(process.cwd(), 'audits');
const HISTORY_FILE = path.join(AUDITS_DIR, 'history.ndjson');

// ─── Directory bootstrap ──────────────────────────────────────────────────────

function ensureAuditsDir(): void {
  if (!fs.existsSync(AUDITS_DIR)) {
    fs.mkdirSync(AUDITS_DIR, { recursive: true });
  }
}

// ─── Index entry operations ───────────────────────────────────────────────────

/**
 * Append an index entry to history.ndjson.
 * Safe to call from multiple concurrent jobs — each call is one atomic write.
 */
export function appendHistoryEntry(entry: AuditIndexEntry): void {
  ensureAuditsDir();
  fs.appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n', 'utf8');
}

/**
 * Read all history entries, newest-first.
 * Silently skips malformed lines.
 */
export function readHistory(limit = 100): AuditIndexEntry[] {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    const lines = fs.readFileSync(HISTORY_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const entries: AuditIndexEntry[] = [];
    for (const line of lines) {
      try { entries.push(JSON.parse(line) as AuditIndexEntry); } catch { /* skip */ }
    }
    // Newest-first
    return entries.reverse().slice(0, limit);
  } catch {
    return [];
  }
}

// ─── Full result storage ──────────────────────────────────────────────────────

/** Persist the full SiteAuditResult to audits/<jobId>.json. */
export function saveResult(result: SiteAuditResult): void {
  ensureAuditsDir();
  const filePath = path.join(AUDITS_DIR, `${result.jobId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(result), 'utf8');
}

/** Load a full SiteAuditResult from disk. Returns null if not found. */
export function loadResult(jobId: string): SiteAuditResult | null {
  const filePath = path.join(AUDITS_DIR, `${jobId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as SiteAuditResult;
  } catch {
    return null;
  }
}

/** Delete result files older than maxAgeDays. Cleans both .json and history entries. */
export function pruneOldResults(maxAgeDays = 30): void {
  ensureAuditsDir();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  try {
    const files = fs.readdirSync(AUDITS_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(AUDITS_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
      }
    }
  } catch { /* best-effort */ }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build an AuditIndexEntry from a completed SiteAuditResult. */
export function buildIndexEntry(result: SiteAuditResult): AuditIndexEntry {
  let domain = '';
  try { domain = new URL(result.config.url).hostname; } catch { /* ignore */ }

  return {
    jobId: result.jobId,
    url: result.config.url,
    domain,
    crawlMode: result.config.crawlMode,
    pagesCrawled: result.pages.length,
    auditedAt: result.auditedAt,
    durationMs: result.durationMs,
    healthScore: result.healthScore.overall,
    grade: result.healthScore.grade,
    issueCount: result.siteWide.issueCount,
  };
}
