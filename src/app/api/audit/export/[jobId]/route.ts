import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/auditJobManager';
import { getResult } from '@/lib/auditJobManager';
import { loadResult } from '@/lib/auditHistory';
import type { SiteAuditResult, AuditIssue } from '@/types/audit';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;

  const job = getJob(jobId);
  if (!job || job.status !== 'complete') {
    return NextResponse.json({ error: 'Audit not found or not yet complete' }, { status: 404 });
  }

  const result: SiteAuditResult | null = getResult(jobId) ?? loadResult(jobId);
  if (!result) {
    return NextResponse.json({ error: 'Result data not found — re-run the audit' }, { status: 404 });
  }

  const html = buildReport(result);
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="qa-report-${safeFilename(result.config.url)}.html"`,
    },
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeFilename(url: string): string {
  try {
    return new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '-');
  } catch {
    return 'report';
  }
}

function gradeColor(g?: string): string {
  const m: Record<string, string> = { A: '#3dd68c', B: '#7dc26d', C: '#f5a623', D: '#e87b2a', F: '#f75555' };
  return m[g?.charAt(0) ?? ''] ?? '#888';
}

function sevColor(s?: string): string {
  return s === 'critical' ? '#f75555' : s === 'warning' ? '#f5a623' : '#5e6ad2';
}

function ms(n: number): string {
  return n > 999 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`;
}

function buildReport(r: SiteAuditResult): string {
  const hs = r.healthScore;
  const date = new Date(r.auditedAt).toLocaleString();
  const issues = r.siteWide?.uniqueIssues ?? [];
  const critical = issues.filter((i: AuditIssue) => i.severity === 'critical');
  const warnings = issues.filter((i: AuditIssue) => i.severity === 'warning');
  const info = issues.filter((i: AuditIssue) => i.severity === 'info');
  const recs = r.recommendations ?? [];

  const issueRows = (list: AuditIssue[]) =>
    list.map(i => `
      <tr>
        <td style="padding:8px 10px;vertical-align:top;white-space:nowrap">
          <span style="display:inline-block;padding:2px 7px;border-radius:3px;font-size:11px;font-weight:600;
            color:${sevColor(i.severity)};background:${sevColor(i.severity)}22;text-transform:uppercase">
            ${i.severity}
          </span>
        </td>
        <td style="padding:8px 10px;vertical-align:top;font-size:13px;font-weight:600">${esc(i.title)}</td>
        <td style="padding:8px 10px;vertical-align:top;font-size:12px;color:#888">${esc(i.description ?? '')}</td>
        <td style="padding:8px 10px;vertical-align:top;font-size:11px;color:#888;white-space:nowrap">${esc(i.category ?? '')}</td>
      </tr>`).join('');

  const scoreRows = Object.entries(hs.breakdown ?? {}).map(([cat, score]) => {
    const pct = typeof score === 'number' ? score : 0;
    return `
      <tr>
        <td style="padding:6px 10px;font-size:13px;text-transform:capitalize">${esc(cat)}</td>
        <td style="padding:6px 10px;width:200px">
          <div style="height:6px;border-radius:3px;background:#2a2a2a;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${gradeColor(hs.grade)};border-radius:3px"></div>
          </div>
        </td>
        <td style="padding:6px 10px;font-size:13px;font-weight:600;color:${gradeColor(hs.grade)}">${pct}</td>
      </tr>`;
  }).join('');

  const recItems = recs.slice(0, 10).map((rec: { title?: string; description?: string; priority?: string }, idx: number) => `
    <li style="padding:10px 0;border-bottom:1px solid #222;font-size:13px">
      <strong>${idx + 1}. ${esc(rec.title ?? '')}</strong>
      ${rec.priority ? `<span style="margin-left:8px;padding:1px 6px;border-radius:3px;font-size:11px;background:#5e6ad222;color:#5e6ad2">${esc(rec.priority)}</span>` : ''}
      <div style="color:#888;margin-top:4px;font-size:12px">${esc(rec.description ?? '')}</div>
    </li>`).join('');

  const pageRows = r.pages.slice(0, 50).map(pg => `
    <tr>
      <td style="padding:6px 10px;font-size:12px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        <a href="${esc(pg.url)}" style="color:#5e6ad2;text-decoration:none" target="_blank">${esc(pg.url)}</a>
      </td>
      <td style="padding:6px 10px;font-size:12px;color:#888">${pg.issues?.length ?? 0} issues</td>
      <td style="padding:6px 10px;font-size:12px;color:#888">${pg.loadTimeMs ? ms(pg.loadTimeMs) : '—'}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA Report — ${esc(r.config.url)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui,-apple-system,sans-serif; background: #0a0a0b; color: #f0f0f0; line-height: 1.55; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 40px 24px 80px; }
  h2 { font-size: 15px; font-weight: 600; letter-spacing: -.01em; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #222; color: #ccc; }
  .section { margin-top: 40px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  tr:nth-child(even) { background: rgba(255,255,255,.02); }
  th { text-align: left; padding: 8px 10px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: #666; border-bottom: 1px solid #222; }
  a { color: #5e6ad2; }
  @media print { body { background: #fff; color: #000; } a { color: #333; } }
</style>
</head>
<body>
<div class="wrap">

  <!-- Header -->
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:40px;padding-bottom:24px;border-bottom:1px solid #222">
    <div>
      <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">QA Audit Report</div>
      <div style="font-size:20px;font-weight:700;letter-spacing:-.02em;margin-bottom:4px">${esc(r.config.url)}</div>
      <div style="font-size:12px;color:#666">${date} · ${r.pages.length} page${r.pages.length !== 1 ? 's' : ''} · ${ms(r.durationMs)} · ${r.crawlSummary?.mode ?? r.config.crawlMode}</div>
    </div>
    <div style="text-align:center;flex-shrink:0">
      <div style="font-size:52px;font-weight:800;line-height:1;color:${gradeColor(hs.grade)}">${hs.grade}</div>
      <div style="font-size:28px;font-weight:700;color:${gradeColor(hs.grade)}">${hs.overall}<span style="font-size:14px;color:#666">/100</span></div>
    </div>
  </div>

  <!-- Issue summary -->
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:40px">
    <div style="padding:16px;border-radius:8px;background:rgba(247,85,85,.08);border:1px solid rgba(247,85,85,.2)">
      <div style="font-size:28px;font-weight:700;color:#f75555">${critical.length}</div>
      <div style="font-size:12px;color:#888;margin-top:2px">Critical issues</div>
    </div>
    <div style="padding:16px;border-radius:8px;background:rgba(245,166,35,.08);border:1px solid rgba(245,166,35,.2)">
      <div style="font-size:28px;font-weight:700;color:#f5a623">${warnings.length}</div>
      <div style="font-size:12px;color:#888;margin-top:2px">Warnings</div>
    </div>
    <div style="padding:16px;border-radius:8px;background:rgba(94,106,210,.08);border:1px solid rgba(94,106,210,.2)">
      <div style="font-size:28px;font-weight:700;color:#5e6ad2">${info.length}</div>
      <div style="font-size:12px;color:#888;margin-top:2px">Info</div>
    </div>
  </div>

  <!-- Category scores -->
  ${scoreRows ? `<div class="section">
    <h2>Category Scores</h2>
    <table><tbody>${scoreRows}</tbody></table>
  </div>` : ''}

  <!-- Issues -->
  ${issues.length ? `<div class="section">
    <h2>All Issues (${issues.length})</h2>
    <table>
      <thead><tr><th>Severity</th><th>Issue</th><th>Description</th><th>Category</th></tr></thead>
      <tbody>${issueRows(issues)}</tbody>
    </table>
  </div>` : ''}

  <!-- Recommendations -->
  ${recs.length ? `<div class="section">
    <h2>Recommendations</h2>
    <ol style="list-style:none">${recItems}</ol>
  </div>` : ''}

  <!-- Pages crawled -->
  ${r.pages.length ? `<div class="section">
    <h2>Pages Crawled (${r.pages.length})</h2>
    <table>
      <thead><tr><th>URL</th><th>Issues</th><th>Load Time</th></tr></thead>
      <tbody>${pageRows}</tbody>
    </table>
  </div>` : ''}

  <div style="margin-top:48px;font-size:11px;color:#444;text-align:center">
    Generated by Simprosys QA Platform · ${date}
  </div>
</div>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
