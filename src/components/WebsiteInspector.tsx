'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type {
  SiteAuditResult, AuditSSEEvent, CrawlMode, AuditCategory,
  AuditIssue, AuditIndexEntry, FixItem, AiRecommendation, QaTestCase,
} from '@/types/audit';

// ─── Constants ─────────────────────────────────────────────────────────────────

type InspectorView = 'start' | 'progress' | 'results';

const ALL_CATEGORIES: AuditCategory[] = [
  'seo','accessibility','performance','security','uiux','content','tech','functional','visual',
];

const CATEGORY_LABELS: Record<AuditCategory, string> = {
  seo: 'SEO', accessibility: 'Accessibility', performance: 'Performance',
  security: 'Security', uiux: 'UI/UX', content: 'Content',
  tech: 'Technology', functional: 'Functional', visual: 'Visual AI',
};

const TABS: { id: string; label: string; group: 'core' | 'audits' | 'ai' | 'other' }[] = [
  { id: 'overview',        label: 'Overview',        group: 'core'   },
  { id: 'issues',          label: 'All Issues',       group: 'core'   },
  { id: 'seo',             label: 'SEO',              group: 'audits' },
  { id: 'accessibility',   label: 'Accessibility',    group: 'audits' },
  { id: 'performance',     label: 'Performance',      group: 'audits' },
  { id: 'security',        label: 'Security',         group: 'audits' },
  { id: 'uiux',            label: 'UI/UX',            group: 'audits' },
  { id: 'content',         label: 'Content',          group: 'audits' },
  { id: 'tech',            label: 'Technology',       group: 'audits' },
  { id: 'functional',      label: 'Functional',       group: 'audits' },
  { id: 'visual',          label: 'Visual AI',        group: 'audits' },
  { id: 'recommendations', label: 'Recommendations',  group: 'ai'     },
  { id: 'qa',              label: 'QA Tests',         group: 'ai'     },
  { id: 'playwright',      label: 'Playwright',       group: 'ai'     },
  { id: 'fixes',           label: 'Fixes',            group: 'ai'     },
  { id: 'history',         label: 'History',          group: 'other'  },
];

const CRAWL_MODES: { value: CrawlMode; label: string; desc: string }[] = [
  { value: 'single',    label: 'Single Page',     desc: '1 page, full audit'      },
  { value: 'topPages',  label: 'Top Pages',       desc: 'Up to 10 pages'          },
  { value: 'fullCrawl', label: 'Full Crawl',       desc: 'Up to 50 pages'          },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function gradeColor(g?: string) {
  const m: Record<string, string> = { A:'#3dd68c', B:'#7dc26d', C:'#f5a623', D:'#e87b2a', F:'#f75555' };
  return m[g ?? ''] ?? '#888';
}
function sevColor(s?: string) {
  return s === 'critical' ? '#f75555' : s === 'warning' ? '#f5a623' : '#5e6ad2';
}
function sevBg(s?: string) {
  return s === 'critical' ? 'rgba(247,85,85,.15)' : s === 'warning' ? 'rgba(245,166,35,.15)' : 'rgba(94,106,210,.15)';
}
function fmt(n: number, unit = '') { return `${n.toLocaleString()}${unit}`; }
function ms(n: number) { return n > 999 ? `${(n/1000).toFixed(1)}s` : `${n}ms`; }
function kb(n: number) { return n > 999 ? `${(n/1024).toFixed(0)}KB` : `${n}B`; }

// ─── Small UI atoms ────────────────────────────────────────────────────────────

function SevBadge({ s }: { s: string }) {
  return (
    <span style={{ fontSize:'0.7rem', fontWeight:600, padding:'2px 7px', borderRadius:3,
      color: sevColor(s), background: sevBg(s), textTransform:'uppercase', letterSpacing:'0.05em' }}>
      {s}
    </span>
  );
}

function StatBox({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="inspector-stat-card">
      <div className="inspector-stat-value">{value}</div>
      <div className="inspector-stat-label">{label}</div>
      {sub && <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginTop:2 }}>{sub}</div>}
    </div>
  );
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const c = score >= 80 ? '#3dd68c' : score >= 60 ? '#f5a623' : '#f75555';
  return (
    <div style={{ marginBottom:8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.8rem', marginBottom:3 }}>
        <span style={{ color:'var(--text-muted)' }}>{label}</span>
        <span style={{ color:c, fontWeight:600 }}>{score}</span>
      </div>
      <div style={{ height:4, borderRadius:2, background:'rgba(255,255,255,.08)' }}>
        <div style={{ height:'100%', borderRadius:2, width:`${score}%`, background:c, transition:'width .4s' }} />
      </div>
    </div>
  );
}

function IssueRow({ issue }: { issue: AuditIssue }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'90px 90px 1fr auto', gap:8, alignItems:'start',
      padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
      <SevBadge s={issue.severity} />
      <span style={{ fontSize:'0.75rem', color:'var(--text-muted)', textTransform:'uppercase',
        letterSpacing:'0.04em', paddingTop:2 }}>{issue.category}</span>
      <div>
        <div style={{ fontSize:'0.85rem', color:'var(--text-main)', lineHeight:1.3 }}>{issue.title}</div>
        {issue.description !== issue.title && (
          <div style={{ fontSize:'0.75rem', color:'var(--text-muted)', marginTop:2, lineHeight:1.4 }}>
            {issue.description.slice(0, 140)}{issue.description.length > 140 ? '…' : ''}
          </div>
        )}
      </div>
      {issue.pages && issue.pages.length > 1 && (
        <span style={{ fontSize:'0.7rem', color:'var(--text-muted)', whiteSpace:'nowrap' }}>
          {issue.pages.length} pages
        </span>
      )}
    </div>
  );
}

function CodeBlock({ code, language = '' }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };
  return (
    <div style={{ position:'relative', background:'rgba(0,0,0,.4)', borderRadius:6,
      border:'1px solid rgba(255,255,255,.08)', overflow:'hidden' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
        padding:'6px 12px', borderBottom:'1px solid rgba(255,255,255,.06)',
        background:'rgba(255,255,255,.03)' }}>
        <span style={{ fontSize:'0.7rem', color:'var(--text-muted)', textTransform:'uppercase' }}>{language || 'code'}</span>
        <button onClick={copy} className="btn-secondary" style={{ fontSize:'0.7rem', padding:'2px 8px' }}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre style={{ margin:0, padding:'12px', overflowX:'auto', fontSize:'0.78rem',
        lineHeight:1.6, color:'#e0e0e0', whiteSpace:'pre', fontFamily:'var(--font-mono, monospace)' }}>
        {code}
      </pre>
    </div>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div style={{ textAlign:'center', padding:'48px 24px', color:'var(--text-muted)', fontSize:'0.9rem' }}>
      {msg}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function WebsiteInspector() {
  const [view, setView]                 = useState<InspectorView>('start');
  const [inputUrl, setInputUrl]         = useState('');
  const [crawlMode, setCrawlMode]       = useState<CrawlMode>('single');
  const [categories, setCategories]     = useState<AuditCategory[]>([...ALL_CATEGORIES]);
  const [starting, setStarting]         = useState(false);
  const [auditError, setAuditError]     = useState<string | null>(null);

  // Progress
  const [progress, setProgress]         = useState(0);
  const [phaseLabel, setPhaseLabel]     = useState('');
  const [crawledCount, setCrawledCount] = useState(0);
  const [discCount, setDiscCount]       = useState(0);
  const [crawlUrl, setCrawlUrl]         = useState('');
  const [liveIssues, setLiveIssues]     = useState({ critical:0, warning:0, info:0 });
  const [log, setLog]                   = useState<string[]>([]);

  // Results
  const [result, setResult]             = useState<SiteAuditResult | null>(null);
  const [activeTab, setActiveTab]       = useState('overview');
  const [sevFilter, setSevFilter]       = useState('all');
  const [catFilter, setCatFilter]       = useState('all');
  const [historyData, setHistoryData]         = useState<AuditIndexEntry[] | null>(null);
  const [loadingEntryId, setLoadingEntryId]   = useState<string | null>(null);
  const [expandedId, setExpandedId]           = useState<string | null>(null);

  const esRef           = useRef<EventSource | null>(null);
  const logRef          = useRef<HTMLDivElement>(null);
  const historyFetching = useRef(false);

  useEffect(() => { logRef.current?.scrollIntoView({ behavior:'smooth' }); }, [log]);

  const addLog = useCallback((msg: string) => {
    setLog(prev => [...prev.slice(-79), msg]);
  }, []);

  // ── Start audit ────────────────────────────────────────────────────────────

  const startAudit = async () => {
    const trimmed = inputUrl.trim();
    if (!trimmed) return;
    setStarting(true);
    setAuditError(null);
    setProgress(0);
    setLiveIssues({ critical:0, warning:0, info:0 });
    setLog([]);
    setCrawledCount(0);
    setDiscCount(0);
    setCrawlUrl('');

    try {
      const res = await fetch('/api/audit/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed, crawlMode, categories }),
      });
      const data = await res.json();
      if (!res.ok || !data.jobId) {
        setAuditError(data.error || 'Failed to start audit');
        setStarting(false);
        return;
      }
      setView('progress');
      setPhaseLabel('Starting…');
      connectSSE(data.jobId, trimmed);
    } catch (e: any) {
      setAuditError(e.message || 'Network error');
      setStarting(false);
    }
  };

  const connectSSE = (jobId: string, auditedUrl: string) => {
    esRef.current?.close();
    const es = new EventSource(`/api/audit/stream/${jobId}`);
    esRef.current = es;

    es.onmessage = async (e) => {
      let ev: AuditSSEEvent;
      try { ev = JSON.parse(e.data); } catch { return; }

      switch (ev.type) {
        case 'phase_start':
        case 'phase_complete':
          setPhaseLabel(ev.phaseLabel);
          setProgress(ev.totalProgress);
          addLog(`▸ ${ev.phaseLabel}`);
          break;
        case 'crawl_progress':
          setCrawledCount(ev.crawled);
          setDiscCount(ev.discovered);
          setCrawlUrl(ev.currentUrl);
          break;
        case 'page_start':
          addLog(`  Auditing (${ev.pageIndex + 1}/${ev.totalPages}): ${ev.url}`);
          break;
        case 'page_complete':
          break;
        case 'issue_found':
          setLiveIssues(prev => ({ ...prev, [ev.issue.severity]: prev[ev.issue.severity as keyof typeof prev] + 1 }));
          break;
        case 'complete': {
          setProgress(100);
          setPhaseLabel(`Complete — score: ${ev.healthScore} (${ev.grade})`);
          addLog(`✓ Audit complete — score ${ev.healthScore}/${ev.grade}, ${ev.pagesCrawled} page(s)`);
          es.close();
          const r = await fetch(`/api/audit/result/${jobId}`);
          if (r.ok) {
            const data = await r.json();
            setResult(data);
            setActiveTab('overview');
            setView('results');
          } else {
            setAuditError('Audit finished but result unavailable');
          }
          break;
        }
        case 'error':
          setAuditError(ev.message);
          setPhaseLabel('Error');
          addLog(`✗ ${ev.message}`);
          es.close();
          break;
      }
    };
    es.onerror = () => addLog('⚠ SSE connection lost');
  };

  useEffect(() => () => { esRef.current?.close(); }, []);

  const reset = () => {
    esRef.current?.close();
    setView('start');
    setResult(null);
    setAuditError(null);
    setLog([]);
    setStarting(false);
    setProgress(0);
  };

  const loadHistory = async () => {
    if (historyFetching.current) return;
    historyFetching.current = true;
    setHistoryData(null);
    try {
      const r = await fetch('/api/audit/history');
      const d = await r.json();
      setHistoryData(d.history || []);
    } catch { setHistoryData([]); }
    finally { historyFetching.current = false; }
  };

  const loadHistoryEntry = async (jobId: string, url: string) => {
    setLoadingEntryId(jobId);
    try {
      const r = await fetch(`/api/audit/result/${jobId}`);
      if (!r.ok) throw new Error('Result not found');
      const data: SiteAuditResult = await r.json();
      setResult(data);
      setInputUrl(url);
      setActiveTab('overview');
    } catch {
      // entry may only exist in history index but not on disk — just switch to overview with no result
      setActiveTab('overview');
    } finally {
      setLoadingEntryId(null);
    }
  };

  const toggleExpand = (id: string) => setExpandedId(prev => prev === id ? null : id);

  // ── Start Screen ────────────────────────────────────────────────────────────

  if (view === 'start') {
    return (
      <div style={{ maxWidth:680, margin:'0 auto', padding:'40px 24px' }}>
        <div style={{ textAlign:'center', marginBottom:40 }}>
          <div style={{ fontSize:'3rem', marginBottom:12 }}>🔍</div>
          <h2 style={{ fontSize:'1.6rem', fontWeight:700, margin:0 }}>Website Inspector</h2>
          <p style={{ color:'var(--text-muted)', marginTop:8 }}>
            Full-site audit: SEO · Accessibility · Performance · Security · UI/UX · AI Recommendations
          </p>
        </div>

        <div className="panel" style={{ padding:24, marginBottom:20 }}>
          <label style={{ display:'block', fontSize:'0.8rem', color:'var(--text-muted)', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.05em' }}>
            Site URL
          </label>
          <input
            className="url-input"
            placeholder="https://example.com"
            value={inputUrl}
            onChange={e => setInputUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !starting && startAudit()}
            style={{ width:'100%', boxSizing:'border-box', fontSize:'1rem' }}
          />
        </div>

        <div className="panel" style={{ padding:24, marginBottom:20 }}>
          <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:12 }}>
            Crawl Mode
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:10 }}>
            {CRAWL_MODES.map(m => (
              <button
                key={m.value}
                onClick={() => setCrawlMode(m.value)}
                style={{
                  padding:'12px 8px', borderRadius:6, cursor:'pointer', textAlign:'center',
                  border:`1px solid ${crawlMode === m.value ? 'var(--accent)' : 'rgba(255,255,255,.1)'}`,
                  background: crawlMode === m.value ? 'rgba(94,106,210,.15)' : 'rgba(255,255,255,.03)',
                  transition:'all .15s',
                }}
              >
                <div style={{ fontWeight:600, fontSize:'0.85rem', color:'var(--text-main)' }}>{m.label}</div>
                <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginTop:3 }}>{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="panel" style={{ padding:24, marginBottom:28 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>
              Audit Categories
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn-secondary" style={{ fontSize:'0.7rem', padding:'2px 8px' }} onClick={() => setCategories([...ALL_CATEGORIES])}>All</button>
              <button className="btn-secondary" style={{ fontSize:'0.7rem', padding:'2px 8px' }} onClick={() => setCategories([])}>None</button>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8 }}>
            {ALL_CATEGORIES.map(cat => (
              <label key={cat} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer',
                padding:'8px 10px', borderRadius:5, background:'rgba(255,255,255,.03)',
                border:'1px solid rgba(255,255,255,.06)', fontSize:'0.83rem' }}>
                <input
                  type="checkbox"
                  checked={categories.includes(cat)}
                  onChange={e => setCategories(prev => e.target.checked ? [...prev, cat] : prev.filter(c => c !== cat))}
                  style={{ accentColor:'var(--accent)' }}
                />
                {CATEGORY_LABELS[cat]}
              </label>
            ))}
          </div>
        </div>

        {auditError && (
          <div style={{ padding:'10px 14px', borderRadius:6, background:'rgba(247,85,85,.12)',
            border:'1px solid rgba(247,85,85,.3)', color:'#f75555', fontSize:'0.85rem', marginBottom:16 }}>
            {auditError}
          </div>
        )}

        <button
          className="run-btn"
          onClick={startAudit}
          disabled={starting || !inputUrl.trim() || categories.length === 0}
          style={{ width:'100%', padding:'14px', fontSize:'1rem', fontWeight:600 }}
        >
          {starting ? 'Starting…' : '🔍 Start Audit'}
        </button>

        <div style={{ textAlign:'center', marginTop:16 }}>
          <button onClick={() => { setActiveTab('history'); loadHistory(); setView('results'); setResult(null); }}
            style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:'0.83rem' }}>
            View audit history →
          </button>
        </div>
      </div>
    );
  }

  // ── Progress Screen ─────────────────────────────────────────────────────────

  if (view === 'progress') {
    return (
      <div style={{ maxWidth:640, margin:'0 auto', padding:'40px 24px' }}>
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{ fontSize:'0.85rem', color:'var(--text-muted)', marginBottom:6 }}>Auditing</div>
          <div style={{ fontWeight:600, wordBreak:'break-all', fontSize:'1rem' }}>{inputUrl}</div>
        </div>

        {/* Progress bar */}
        <div style={{ marginBottom:8, display:'flex', justifyContent:'space-between', fontSize:'0.8rem' }}>
          <span style={{ color:'var(--text-muted)' }}>{phaseLabel}</span>
          <span style={{ color:'var(--accent)', fontWeight:600 }}>{progress}%</span>
        </div>
        <div style={{ height:6, borderRadius:3, background:'rgba(255,255,255,.08)', marginBottom:24 }}>
          <div style={{ height:'100%', borderRadius:3, background:'var(--accent)', width:`${progress}%`, transition:'width .5s ease' }} />
        </div>

        {/* Crawl stats */}
        {crawledCount > 0 && (
          <div className="inspector-stats" style={{ marginBottom:20 }}>
            <StatBox label="Discovered" value={discCount} />
            <StatBox label="Crawled" value={crawledCount} />
            <StatBox label="Critical" value={liveIssues.critical} />
            <StatBox label="Warnings" value={liveIssues.warning} />
          </div>
        )}

        {crawlUrl && (
          <div style={{ fontSize:'0.75rem', color:'var(--text-muted)', marginBottom:16,
            padding:'6px 10px', background:'rgba(255,255,255,.03)', borderRadius:4,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {crawlUrl}
          </div>
        )}

        {/* Live log */}
        <div style={{ background:'rgba(0,0,0,.3)', borderRadius:6, border:'1px solid rgba(255,255,255,.06)',
          maxHeight:220, overflowY:'auto', padding:'10px 14px' }}>
          {log.map((line, i) => (
            <div key={i} style={{ fontSize:'0.75rem', color:'var(--text-muted)', lineHeight:1.8,
              fontFamily:'monospace', borderBottom: i < log.length - 1 ? '1px solid rgba(255,255,255,.03)' : 'none' }}>
              {line}
            </div>
          ))}
          <div ref={logRef} />
        </div>

        {auditError && (
          <div style={{ padding:'10px 14px', borderRadius:6, background:'rgba(247,85,85,.12)',
            border:'1px solid rgba(247,85,85,.3)', color:'#f75555', fontSize:'0.85rem', marginTop:16 }}>
            {auditError}
            <button onClick={reset} style={{ float:'right', background:'none', border:'none', color:'#f75555', cursor:'pointer', fontSize:'0.85rem' }}>
              ← Start over
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Results Screen ──────────────────────────────────────────────────────────

  const p0 = result?.pages?.[0];
  const hs = result?.healthScore;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      {/* Results header */}
      <div style={{ padding:'16px 24px', borderBottom:'1px solid rgba(255,255,255,.06)',
        display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:'0.75rem', color:'var(--text-muted)', marginBottom:2 }}>Audited</div>
          <div style={{ fontWeight:600, fontSize:'0.9rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {result?.config.url ?? inputUrl}
          </div>
          {result && (
            <div style={{ fontSize:'0.73rem', color:'var(--text-muted)', marginTop:2 }}>
              {result.pages.length} page{result.pages.length !== 1 ? 's' : ''} · {ms(result.durationMs)} · {result.crawlSummary.mode}
            </div>
          )}
        </div>

        {hs && (
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:'2rem', fontWeight:800, color: gradeColor(hs.grade), lineHeight:1 }}>{hs.overall}</div>
              <div style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>/ 100</div>
            </div>
            <div style={{ width:48, height:48, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center',
              background:`conic-gradient(${gradeColor(hs.grade)} 0% ${hs.overall}%, rgba(255,255,255,.08) ${hs.overall}% 100%)`,
              fontSize:'1rem', fontWeight:800, color: gradeColor(hs.grade) }}>
              {hs.grade}
            </div>
          </div>
        )}

        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {result && (
            <>
              <span style={{ padding:'3px 8px', borderRadius:3, fontSize:'0.73rem', fontWeight:600, background:'rgba(247,85,85,.15)', color:'#f75555' }}>
                {result.siteWide.issueCount.critical} critical
              </span>
              <span style={{ padding:'3px 8px', borderRadius:3, fontSize:'0.73rem', fontWeight:600, background:'rgba(245,166,35,.15)', color:'#f5a623' }}>
                {result.siteWide.issueCount.warning} warnings
              </span>
            </>
          )}
          {result && (
            <a
              href={`/api/audit/export/${result.jobId}`}
              download
              className="btn-secondary"
              style={{ fontSize:'0.75rem', padding:'3px 10px', textDecoration:'none', lineHeight:'1.6', display:'inline-block' }}
            >
              Export Report
            </a>
          )}
          <button onClick={reset} className="btn-secondary" style={{ fontSize:'0.75rem', padding:'3px 10px' }}>
            New Audit
          </button>
        </div>
      </div>

      {/* Tab navigation */}
      <div style={{ display:'flex', gap:1, overflowX:'auto', padding:'0 16px',
        borderBottom:'1px solid rgba(255,255,255,.06)', background:'rgba(255,255,255,.01)' }}>
        {(['core','audits','ai','other'] as const).map(group => (
          <div key={group} style={{ display:'flex', gap:1, alignItems:'stretch' }}>
            {TABS.filter(t => t.group === group).map(tab => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); if (tab.id === 'history') loadHistory(); }}
                style={{
                  padding:'10px 14px', fontSize:'0.78rem', fontWeight: activeTab === tab.id ? 600 : 400,
                  background:'none', border:'none', cursor:'pointer', whiteSpace:'nowrap',
                  color: activeTab === tab.id ? 'var(--text-main)' : 'var(--text-muted)',
                  borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                  transition:'all .12s',
                }}
              >
                {tab.label}
              </button>
            ))}
            {group !== 'other' && (
              <div style={{ width:1, background:'rgba(255,255,255,.06)', margin:'8px 4px' }} />
            )}
          </div>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex:1, overflowY:'auto', padding:24 }}>
        {renderTab()}
      </div>
    </div>
  );

  // ── Tab renderer ────────────────────────────────────────────────────────────

  function renderTab() {
    if (!result && activeTab !== 'history') return <EmptyState msg="No audit results available. Run an audit first." />;

    switch (activeTab) {

      // ── Overview ────────────────────────────────────────────────────────────
      case 'overview': {
        if (!result || !hs) return null;
        const { siteWide, crawlSummary } = result;
        return (
          <div style={{ display:'grid', gap:20 }}>
            {/* Score breakdown */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              <div className="panel" style={{ padding:20 }}>
                <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:14 }}>Score Breakdown</div>
                {Object.entries(hs.breakdown).map(([cat, score]) => (
                  <ScoreBar key={cat} label={CATEGORY_LABELS[cat as AuditCategory] || cat} score={score} />
                ))}
              </div>
              <div className="panel" style={{ padding:20 }}>
                <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:14 }}>Crawl Summary</div>
                <StatBox label="Pages Crawled" value={crawlSummary.pagesCrawled} />
                <StatBox label="Issues Found" value={siteWide.issueCount.critical + siteWide.issueCount.warning + siteWide.issueCount.info} sub={`${siteWide.issueCount.critical} critical · ${siteWide.issueCount.warning} warnings`} />
                {crawlSummary.sitemapFound && <StatBox label="Sitemap Pages" value={crawlSummary.sitemapPageCount} />}
                <div style={{ marginTop:12, fontSize:'0.8rem', color:'var(--text-muted)' }}>
                  robots.txt: <span style={{ color: crawlSummary.robotsTxtFound ? '#3dd68c' : '#f75555' }}>{crawlSummary.robotsTxtFound ? 'Found' : 'Missing'}</span>
                  {' · '}sitemap: <span style={{ color: crawlSummary.sitemapFound ? '#3dd68c' : '#f75555' }}>{crawlSummary.sitemapFound ? 'Found' : 'Missing'}</span>
                </div>
              </div>
            </div>
            {/* Top issues */}
            <div className="panel" style={{ padding:20 }}>
              <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:14 }}>
                Top Critical Issues
              </div>
              {siteWide.uniqueIssues.filter(i => i.severity === 'critical').slice(0, 8).map(i => <IssueRow key={i.id} issue={i} />)}
              {siteWide.uniqueIssues.filter(i => i.severity === 'critical').length === 0 && (
                <div style={{ color:'#3dd68c', fontSize:'0.85rem' }}>✓ No critical issues found</div>
              )}
            </div>
            {/* Pages table */}
            {result.pages.length > 1 && (
              <div className="panel" style={{ padding:20 }}>
                <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:14 }}>Pages Audited</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr auto auto auto', gap:'8px 16px', alignItems:'center' }}>
                  <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', fontWeight:600, paddingBottom:4, borderBottom:'1px solid rgba(255,255,255,.06)' }}>URL</div>
                  <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', fontWeight:600, paddingBottom:4, borderBottom:'1px solid rgba(255,255,255,.06)' }}>Score</div>
                  <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', fontWeight:600, paddingBottom:4, borderBottom:'1px solid rgba(255,255,255,.06)' }}>Load</div>
                  <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', fontWeight:600, paddingBottom:4, borderBottom:'1px solid rgba(255,255,255,.06)' }}>Issues</div>
                  {result.pages.map(pg => (
                    <React.Fragment key={pg.url}>
                      <div style={{ fontSize:'0.78rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:320 }}>
                        {pg.url.replace(result.config.url, '') || '/'}
                      </div>
                      <div style={{ fontSize:'0.8rem', fontWeight:600, color: pg.pageScore >= 80 ? '#3dd68c' : pg.pageScore >= 60 ? '#f5a623' : '#f75555' }}>{pg.pageScore}</div>
                      <div style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>{ms(pg.loadTimeMs)}</div>
                      <div style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>{pg.issues.length}</div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      }

      // ── All Issues ───────────────────────────────────────────────────────────
      case 'issues': {
        if (!result) return null;
        const allIssues = result.siteWide.uniqueIssues;
        const filtered = allIssues.filter(i =>
          (sevFilter === 'all' || i.severity === sevFilter) &&
          (catFilter === 'all' || i.category === catFilter),
        );
        return (
          <div>
            <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap' }}>
              {['all','critical','warning','info'].map(s => (
                <button key={s} onClick={() => setSevFilter(s)}
                  className={sevFilter === s ? 'btn-primary' : 'btn-secondary'}
                  style={{ fontSize:'0.78rem', padding:'4px 12px', textTransform:'capitalize' }}>
                  {s} {s !== 'all' && `(${allIssues.filter(i => i.severity === s).length})`}
                </button>
              ))}
              <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
                style={{ padding:'4px 10px', borderRadius:5, background:'rgba(255,255,255,.05)',
                  border:'1px solid rgba(255,255,255,.1)', color:'var(--text-main)', fontSize:'0.78rem' }}>
                <option value="all">All categories</option>
                {ALL_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
              <span style={{ fontSize:'0.78rem', color:'var(--text-muted)', alignSelf:'center', marginLeft:'auto' }}>
                {filtered.length} issues
              </span>
            </div>
            {filtered.length === 0
              ? <EmptyState msg="No issues match the current filters" />
              : filtered.map(i => <IssueRow key={i.id} issue={i} />)
            }
          </div>
        );
      }

      // ── SEO ──────────────────────────────────────────────────────────────────
      case 'seo': {
        const seo = p0?.seo;
        if (!seo) return <EmptyState msg="SEO data not available" />;
        return (
          <div style={{ display:'grid', gap:16 }}>
            <div className="inspector-stats">
              <StatBox label="Title Length" value={seo.titleLength} sub={seo.titleLength < 30 ? 'Too short' : seo.titleLength > 60 ? 'Too long' : 'Good'} />
              <StatBox label="Description" value={seo.descriptionLength} sub={`chars`} />
              <StatBox label="H1 Count" value={seo.h1Count} sub={seo.h1Count === 1 ? 'Good' : seo.h1Count === 0 ? 'Missing' : 'Multiple'} />
              <StatBox label="Images" value={seo.imageCount} sub={`${seo.imagesWithoutAlt} missing alt`} />
              <StatBox label="Int. Links" value={seo.internalLinkCount} />
              <StatBox label="Ext. Links" value={seo.externalLinkCount} />
            </div>
            <div className="panel" style={{ padding:16 }}>
              {[
                { k:'Title', v: seo.title }, { k:'Description', v: seo.description },
                { k:'Canonical', v: seo.canonical }, { k:'Robots', v: seo.robots || 'Not set' },
                { k:'Viewport', v: seo.viewport || 'Missing' }, { k:'Language', v: seo.lang || 'Missing' },
                { k:'og:title', v: seo.openGraph.title }, { k:'og:image', v: seo.openGraph.image },
              ].map(({ k, v }) => (
                <div key={k} className="meta-row">
                  <span className="meta-key">{k}</span>
                  <span className="meta-value">{v || <span style={{ color:'var(--text-muted)', fontStyle:'italic' }}>not set</span>}</span>
                </div>
              ))}
            </div>
            {seo.headings.length > 0 && (
              <div className="panel" style={{ padding:16 }}>
                <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', marginBottom:10 }}>Headings ({seo.headings.length})</div>
                <div className="heading-tree">
                  {seo.headings.slice(0, 20).map((h, i) => (
                    <div key={i} className="heading-item">
                      <span className="heading-level">H{h.level}</span>
                      <span className="heading-text">{h.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="panel" style={{ padding:16 }}>
              {seo.issues.map(i => <IssueRow key={i.id} issue={i} />)}
              {seo.issues.length === 0 && <div style={{ color:'#3dd68c', fontSize:'0.85rem' }}>✓ No SEO issues found</div>}
            </div>
          </div>
        );
      }

      // ── Accessibility ─────────────────────────────────────────────────────────
      case 'accessibility': {
        const a11y = p0?.accessibility;
        if (!a11y) return <EmptyState msg="Accessibility data not available. Ensure public/vendor/axe.min.js exists." />;
        const { impactBreakdown: ib } = a11y;
        return (
          <div style={{ display:'grid', gap:16 }}>
            <div className="inspector-stats">
              <StatBox label="Violations" value={a11y.violationCount} />
              <StatBox label="Critical" value={ib.critical + ib.serious} />
              <StatBox label="Moderate" value={ib.moderate} />
              <StatBox label="WCAG Level" value={a11y.wcagLevel} />
              <StatBox label="Passed Rules" value={a11y.passCount} />
            </div>
            {a11y.violations.slice(0, 20).map(v => (
              <div key={v.ruleId} className="panel" style={{ padding:14 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
                  <div style={{ fontWeight:600, fontSize:'0.85rem' }}>{v.ruleId}</div>
                  <SevBadge s={v.impact === 'serious' || v.impact === 'critical' ? 'critical' : v.impact === 'moderate' ? 'warning' : 'info'} />
                </div>
                <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', marginBottom:8 }}>{v.description}</div>
                <div style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>{v.nodeCount} element(s) affected</div>
                {v.nodes.slice(0, 2).map((n, i) => (
                  <div key={i} style={{ marginTop:6, background:'rgba(0,0,0,.3)', borderRadius:4, padding:'6px 10px',
                    fontFamily:'monospace', fontSize:'0.72rem', color:'#e0e0e0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {n.selector}
                  </div>
                ))}
              </div>
            ))}
            {a11y.violationCount === 0 && <div style={{ color:'#3dd68c', fontSize:'0.85rem' }}>✓ No accessibility violations found</div>}
          </div>
        );
      }

      // ── Performance ───────────────────────────────────────────────────────────
      case 'performance': {
        const perf = p0?.performance;
        if (!perf) return <EmptyState msg="Performance data not available" />;
        const rb = perf.resourceBreakdown;
        return (
          <div style={{ display:'grid', gap:16 }}>
            <div className="inspector-stats">
              <StatBox label="Load Time" value={ms(perf.loadTimeMs)} />
              <StatBox label="LCP" value={ms(perf.largestContentfulPaintMs)} />
              <StatBox label="FCP" value={ms(perf.firstContentfulPaintMs)} />
              <StatBox label="TBT" value={ms(perf.totalBlockingTimeMs)} />
              <StatBox label="Resources" value={perf.resourceCount} />
              <StatBox label="Page Size" value={kb(rb.totalBytes)} />
            </div>
            <div className="panel" style={{ padding:16 }}>
              <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', marginBottom:12 }}>Resource Breakdown</div>
              {([['JavaScript', rb.jsBytes],['CSS', rb.cssBytes],['Images', rb.imageBytes],['Fonts', rb.fontBytes],['Other', rb.otherBytes]] as [string,number][]).map(([label,bytes]) => (
                bytes > 0 && <div key={label} style={{ display:'flex', justifyContent:'space-between', fontSize:'0.82rem', padding:'4px 0' }}>
                  <span style={{ color:'var(--text-muted)' }}>{label}</span>
                  <span>{kb(bytes)}</span>
                </div>
              ))}
            </div>
            {perf.renderBlocking.length > 0 && (
              <div className="panel" style={{ padding:16 }}>
                <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', marginBottom:10 }}>Render-Blocking Resources ({perf.renderBlocking.length})</div>
                {perf.renderBlocking.slice(0, 8).map((r, i) => (
                  <div key={i} style={{ fontSize:'0.77rem', padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,.04)',
                    display:'flex', justifyContent:'space-between', gap:8 }}>
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1, color:'var(--text-muted)' }}>{r.url.split('/').pop()}</span>
                    <span style={{ color:'#f5a623' }}>{r.type}</span>
                    <span style={{ color:'var(--text-muted)' }}>{kb(r.sizeBytes)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="panel" style={{ padding:16 }}>
              {perf.issues.map(i => <IssueRow key={i.id} issue={i} />)}
              {perf.issues.length === 0 && <div style={{ color:'#3dd68c', fontSize:'0.85rem' }}>✓ No performance issues detected</div>}
            </div>
          </div>
        );
      }

      // ── Security ──────────────────────────────────────────────────────────────
      case 'security': {
        const sec = p0?.security ?? result?.pages.find(p => p.security)?.security;
        if (!sec) return <EmptyState msg="Security data not available" />;
        return (
          <div style={{ display:'grid', gap:16 }}>
            <div className="inspector-stats">
              <StatBox label="HTTPS" value={sec.isHttps ? '✓ Yes' : '✗ No'} />
              <StatBox label="Mixed Content" value={sec.mixedContent.length} />
              <StatBox label="Cookie Issues" value={sec.cookieIssues.length} />
            </div>
            <div className="panel" style={{ padding:16 }}>
              <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', marginBottom:12 }}>Security Headers</div>
              {sec.headers.map(h => (
                <div key={h.header} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                  padding:'7px 0', borderBottom:'1px solid rgba(255,255,255,.04)', fontSize:'0.8rem' }}>
                  <span style={{ fontFamily:'monospace', color:'var(--text-main)' }}>{h.header}</span>
                  <span style={{ color: h.tier === 'deprecated' ? '#f5a623' : h.present ? '#3dd68c' : (h.tier === 'required' ? '#f75555' : '#888') }}>
                    {h.tier === 'deprecated' ? 'Remove' : h.present ? '✓' : h.tier === 'required' ? '✗ Missing' : '— Not set'}
                  </span>
                </div>
              ))}
            </div>
            <div className="panel" style={{ padding:16 }}>
              {sec.issues.map(i => <IssueRow key={i.id} issue={i} />)}
              {sec.issues.length === 0 && <div style={{ color:'#3dd68c', fontSize:'0.85rem' }}>✓ No security issues detected</div>}
            </div>
          </div>
        );
      }

      // ── UI/UX ─────────────────────────────────────────────────────────────────
      case 'uiux': {
        const uiux = p0?.uiux;
        if (!uiux) return <EmptyState msg="UI/UX data not available" />;
        return (
          <div style={{ display:'grid', gap:16 }}>
            <div className="inspector-stats">
              <StatBox label="Overflow Elements" value={uiux.overflowElements.length} />
              <StatBox label="Small Tap Targets" value={uiux.tapTargetFailures.length} />
              <StatBox label="CTA Above Fold" value={uiux.ctaAboveFold ? '✓ Yes' : '✗ No'} />
            </div>
            <div className="panel" style={{ padding:16 }}>
              {uiux.issues.map(i => <IssueRow key={i.id} issue={i} />)}
              {uiux.issues.length === 0 && <div style={{ color:'#3dd68c', fontSize:'0.85rem' }}>✓ No UI/UX issues detected</div>}
            </div>
          </div>
        );
      }

      // ── Content ───────────────────────────────────────────────────────────────
      case 'content': {
        const cnt = p0?.content;
        if (!cnt) return <EmptyState msg="Content data not available" />;
        const ts = cnt.trustSignals;
        return (
          <div style={{ display:'grid', gap:16 }}>
            <div className="inspector-stats">
              <StatBox label="Words" value={fmt(cnt.wordCount)} />
              <StatBox label="Sentences" value={fmt(cnt.sentenceCount)} />
              <StatBox label="Readability" value={cnt.readabilityScore} sub={cnt.readabilityGrade} />
              <StatBox label="CTAs Found" value={cnt.ctaCount} />
            </div>
            <div className="panel" style={{ padding:16 }}>
              <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', marginBottom:12 }}>Trust Signals</div>
              {[
                { label:'Phone number', ok: ts.phoneFound },
                { label:'Email address', ok: ts.emailFound },
                { label:'Physical address', ok: ts.addressFound },
                { label:'Privacy policy link', ok: ts.privacyPolicyLinked },
                { label:'Terms of service link', ok: ts.termsLinked },
              ].map(({ label, ok }) => (
                <div key={label} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0',
                  borderBottom:'1px solid rgba(255,255,255,.04)', fontSize:'0.82rem' }}>
                  <span style={{ color:'var(--text-muted)' }}>{label}</span>
                  <span style={{ color: ok ? '#3dd68c' : '#f75555' }}>{ok ? '✓ Found' : '✗ Missing'}</span>
                </div>
              ))}
            </div>
            <div className="panel" style={{ padding:16 }}>
              {cnt.issues.map(i => <IssueRow key={i.id} issue={i} />)}
              {cnt.issues.length === 0 && <div style={{ color:'#3dd68c', fontSize:'0.85rem' }}>✓ No content issues detected</div>}
            </div>
          </div>
        );
      }

      // ── Technology ─────────────────────────────────────────────────────────────
      case 'tech': {
        const tech = p0?.tech ?? result?.pages.find(p => p.tech)?.tech;
        if (!tech) return <EmptyState msg="Technology detection not available" />;
        const summary = [
          { label:'Framework', v: tech.framework },
          { label:'CMS', v: tech.cms },
          { label:'Ecommerce', v: tech.ecommerce },
          { label:'CDN', v: tech.cdn },
          { label:'Server', v: tech.server },
          { label:'Analytics', v: tech.analytics.join(', ') || null },
          { label:'JS Libraries', v: tech.jsLibraries.join(', ') || null },
        ].filter(s => s.v);
        return (
          <div style={{ display:'grid', gap:16 }}>
            <div className="panel" style={{ padding:16 }}>
              {summary.length === 0
                ? <EmptyState msg="No technologies detected" />
                : summary.map(({ label, v }) => (
                  <div key={label} style={{ display:'flex', justifyContent:'space-between', padding:'7px 0',
                    borderBottom:'1px solid rgba(255,255,255,.04)', fontSize:'0.82rem' }}>
                    <span style={{ color:'var(--text-muted)' }}>{label}</span>
                    <span style={{ fontWeight:500 }}>{v}</span>
                  </div>
                ))
              }
            </div>
            {tech.detected.length > 0 && (
              <div className="panel" style={{ padding:16 }}>
                <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', marginBottom:10 }}>All Detected Signals</div>
                {tech.detected.map((s, i) => (
                  <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 80px 80px', gap:8,
                    padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,.03)', fontSize:'0.78rem' }}>
                    <span style={{ fontWeight:500 }}>{s.name}</span>
                    <span style={{ color:'var(--text-muted)', textTransform:'capitalize' }}>{s.category}</span>
                    <span style={{ color: s.confidence === 'definite' ? '#3dd68c' : '#888', textTransform:'capitalize' }}>{s.confidence}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }

      // ── Functional ────────────────────────────────────────────────────────────
      case 'functional': {
        const func = p0?.functional;
        if (!func) return <EmptyState msg="Functional data not available" />;
        return (
          <div style={{ display:'grid', gap:16 }}>
            <div className="inspector-stats">
              <StatBox label="Broken Links" value={func.brokenLinks.length} />
              <StatBox label="Redirect Chains" value={func.redirectChains.length} />
              <StatBox label="Forms w/o Action" value={func.formsWithoutAction} />
            </div>
            {func.brokenLinks.length > 0 && (
              <div className="panel" style={{ padding:16 }}>
                <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', marginBottom:10 }}>Broken Links ({func.brokenLinks.length})</div>
                {func.brokenLinks.slice(0, 20).map((l, i) => (
                  <div key={i} style={{ display:'grid', gridTemplateColumns:'50px 1fr auto', gap:8,
                    padding:'6px 0', borderBottom:'1px solid rgba(255,255,255,.04)', fontSize:'0.78rem' }}>
                    <span style={{ color:'#f75555', fontWeight:600 }}>{l.statusCode || 'ERR'}</span>
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--text-muted)' }}>{l.url}</span>
                    <span style={{ color:'var(--text-muted)' }}>{l.text.slice(0, 30)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="panel" style={{ padding:16 }}>
              {func.issues.map(i => <IssueRow key={i.id} issue={i} />)}
              {func.issues.length === 0 && <div style={{ color:'#3dd68c', fontSize:'0.85rem' }}>✓ No functional issues detected</div>}
            </div>
          </div>
        );
      }

      // ── Visual AI ─────────────────────────────────────────────────────────────
      case 'visual': {
        const vis = p0?.visualAnalysis;
        const shot = p0?.screenshots.desktop;
        return (
          <div style={{ display:'grid', gap:16 }}>
            {shot && (
              <div className="panel" style={{ padding:12, textAlign:'center' }}>
                <div style={{ fontSize:'0.75rem', color:'var(--text-muted)', marginBottom:8 }}>Desktop Screenshot</div>
                <img src={`data:image/png;base64,${shot}`} alt="Desktop screenshot"
                  style={{ maxWidth:'100%', borderRadius:4, border:'1px solid rgba(255,255,255,.08)' }} />
              </div>
            )}
            {vis ? (
              <>
                <div className="inspector-stats">
                  <StatBox label="Layout Score" value={vis.desktopLayoutScore} />
                  {vis.mobileLayoutScore !== null && <StatBox label="Mobile Score" value={vis.mobileLayoutScore} />}
                  <StatBox label="CTA" value={vis.ctaVisibility.replace('_', ' ')} />
                  <StatBox label="Navigation" value={vis.navigationClarity} />
                  {vis.mobileReadability && <StatBox label="Mobile Readability" value={vis.mobileReadability} />}
                </div>
                {vis.positives.length > 0 && (
                  <div className="panel" style={{ padding:16 }}>
                    <div style={{ fontSize:'0.8rem', color:'#3dd68c', marginBottom:10 }}>✓ Positives</div>
                    {vis.positives.map((p, i) => (
                      <div key={i} style={{ fontSize:'0.82rem', color:'var(--text-muted)', padding:'4px 0', borderBottom:'1px solid rgba(255,255,255,.03)' }}>
                        {p}
                      </div>
                    ))}
                  </div>
                )}
                <div className="panel" style={{ padding:16 }}>
                  <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', marginBottom:10 }}>Visual Issues</div>
                  {vis.visualIssues.map(i => (
                    <IssueRow key={i.id} issue={{ id: i.id, severity: i.severity, category: 'visual',
                      title: i.description, description: i.description, pages: [] }} />
                  ))}
                  {vis.visualIssues.length === 0 && <div style={{ color:'#3dd68c', fontSize:'0.85rem' }}>✓ No visual issues detected</div>}
                </div>
              </>
            ) : (
              <EmptyState msg={shot ? 'Visual AI analysis was not run. Ensure gemma4 is available in Ollama.' : 'Visual AI data not available.'} />
            )}
          </div>
        );
      }

      // ── Recommendations ────────────────────────────────────────────────────────
      case 'recommendations': {
        const recs = result?.recommendations ?? [];
        if (recs.length === 0) return <EmptyState msg="No recommendations generated. Run with AI categories enabled." />;
        return (
          <div style={{ display:'grid', gap:12 }}>
            {recs.map((rec: AiRecommendation) => (
              <div key={rec.id} className="panel" style={{ padding:16, cursor:'pointer' }}
                onClick={() => toggleExpand(rec.id)}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:6 }}>
                      <SevBadge s={rec.severity === 'high' ? 'critical' : rec.severity === 'medium' ? 'warning' : 'info'} />
                      <span style={{ fontSize:'0.7rem', color:'var(--text-muted)', textTransform:'uppercase' }}>{rec.category}</span>
                      <span style={{ fontSize:'0.7rem', color:'var(--text-muted)', padding:'1px 6px', borderRadius:3, border:'1px solid rgba(255,255,255,.1)' }}>{rec.effort}</span>
                    </div>
                    <div style={{ fontWeight:600, fontSize:'0.88rem' }}>{rec.title}</div>
                    <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginTop:4 }}>{rec.impact}</div>
                  </div>
                  <span style={{ color:'var(--text-muted)', fontSize:'0.8rem' }}>{expandedId === rec.id ? '▲' : '▼'}</span>
                </div>
                {expandedId === rec.id && (
                  <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid rgba(255,255,255,.06)' }}>
                    <div style={{ fontSize:'0.82rem', marginBottom:10, lineHeight:1.6 }}>{rec.recommendation}</div>
                    {rec.suggestedFix && (
                      <CodeBlock code={rec.suggestedFix} language="fix" />
                    )}
                    {rec.affectedPages.length > 0 && (
                      <div style={{ fontSize:'0.73rem', color:'var(--text-muted)', marginTop:8 }}>
                        Affects: {rec.affectedPages.slice(0,3).join(', ')}{rec.affectedPages.length > 3 ? ` +${rec.affectedPages.length-3} more` : ''}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      }

      // ── QA Tests ──────────────────────────────────────────────────────────────
      case 'qa': {
        const tests = result?.qaTestCases ?? [];
        if (tests.length === 0) return <EmptyState msg="No QA test cases generated." />;
        return (
          <div style={{ display:'grid', gap:10 }}>
            <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginBottom:4 }}>{tests.length} test case{tests.length !== 1 ? 's' : ''} generated</div>
            {tests.map((tc: QaTestCase) => (
              <div key={tc.id} className="panel" style={{ padding:14, cursor:'pointer' }}
                onClick={() => toggleExpand(tc.id)}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div>
                    <div style={{ display:'flex', gap:8, marginBottom:4 }}>
                      <SevBadge s={tc.priority === 'high' ? 'critical' : tc.priority === 'medium' ? 'warning' : 'info'} />
                      <span style={{ fontSize:'0.7rem', color:'var(--text-muted)', textTransform:'uppercase' }}>{tc.category}</span>
                    </div>
                    <div style={{ fontWeight:600, fontSize:'0.85rem' }}>{tc.title}</div>
                  </div>
                  <span style={{ color:'var(--text-muted)', fontSize:'0.8rem' }}>{expandedId === tc.id ? '▲' : '▼'}</span>
                </div>
                {expandedId === tc.id && (
                  <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid rgba(255,255,255,.06)' }}>
                    <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginBottom:8 }}>Preconditions: {tc.preconditions}</div>
                    {tc.steps.map(s => (
                      <div key={s.stepNumber} style={{ fontSize:'0.8rem', padding:'4px 0', display:'flex', gap:10 }}>
                        <span style={{ color:'var(--accent)', minWidth:20, fontWeight:600 }}>{s.stepNumber}.</span>
                        <span>{s.action}</span>
                      </div>
                    ))}
                    <div style={{ marginTop:10, fontSize:'0.78rem', padding:'8px', background:'rgba(61,214,140,.08)', borderRadius:4, color:'#3dd68c' }}>
                      Expected: {tc.expectedResult}
                    </div>
                    {tc.gherkin && (
                      <div style={{ marginTop:10 }}>
                        <CodeBlock code={tc.gherkin} language="gherkin" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      }

      // ── Playwright ────────────────────────────────────────────────────────────
      case 'playwright': {
        const suite = result?.playwrightSuite;
        if (!suite) return <EmptyState msg="No Playwright test suite generated." />;
        return (
          <div style={{ display:'grid', gap:14 }}>
            <div className="inspector-stats">
              <StatBox label="Tests" value={suite.testCount} />
              <StatBox label="Coverage" value={suite.coverageAreas.join(', ') || '—'} />
            </div>
            <CodeBlock code={suite.script} language="javascript" />
          </div>
        );
      }

      // ── Fixes ──────────────────────────────────────────────────────────────────
      case 'fixes': {
        const fixes = result?.fixes ?? [];
        if (fixes.length === 0) return <EmptyState msg="No fixes generated." />;
        return (
          <div style={{ display:'grid', gap:12 }}>
            {fixes.map((fix: FixItem) => (
              <div key={fix.id} className="panel" style={{ padding:14 }}>
                <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
                  <SevBadge s={fix.severity} />
                  <span style={{ fontSize:'0.7rem', color:'var(--text-muted)', textTransform:'uppercase' }}>{fix.category}</span>
                  <span style={{ fontSize:'0.7rem', color:'var(--text-muted)', padding:'1px 6px', borderRadius:3, border:'1px solid rgba(255,255,255,.1)' }}>{fix.fixType}</span>
                  <span style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginLeft:'auto' }}>{fix.effort} · {fix.applyScope.replace('_',' ')}</span>
                </div>
                <div style={{ fontWeight:600, fontSize:'0.85rem', marginBottom:8 }}>{fix.title}</div>
                {fix.beforeCode && fix.afterCode ? (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                    <div>
                      <div style={{ fontSize:'0.7rem', color:'#f75555', marginBottom:4 }}>Before</div>
                      <CodeBlock code={fix.beforeCode} language={fix.language} />
                    </div>
                    <div>
                      <div style={{ fontSize:'0.7rem', color:'#3dd68c', marginBottom:4 }}>After</div>
                      <CodeBlock code={fix.afterCode} language={fix.language} />
                    </div>
                  </div>
                ) : (
                  <CodeBlock code={fix.codeSnippet} language={fix.language} />
                )}
              </div>
            ))}
          </div>
        );
      }

      // ── History ───────────────────────────────────────────────────────────────
      case 'history': {
        if (historyData === null) return (
          <div style={{ textAlign:'center', padding:48, color:'var(--text-muted)' }}>Loading history…</div>
        );
        if (historyData.length === 0) return <EmptyState msg="No audit history yet. Complete an audit to see results here." />;
        return (
          <div style={{ display:'grid', gap:8 }}>
            {historyData.map((entry: AuditIndexEntry) => {
              const isLoading = loadingEntryId === entry.jobId;
              return (
                <div key={entry.jobId} className="panel" style={{ padding:14, cursor:'pointer',
                  border: isLoading ? '1px solid var(--accent)' : undefined,
                  transition:'border-color .15s' }}
                  onClick={() => loadHistoryEntry(entry.jobId, entry.url)}>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr auto auto auto auto auto', gap:12, alignItems:'center' }}>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontWeight:600, fontSize:'0.85rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {entry.domain}
                      </div>
                      <div style={{ fontSize:'0.73rem', color:'var(--text-muted)', marginTop:2 }}>
                        {entry.url}
                      </div>
                      <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginTop:1 }}>
                        {new Date(entry.auditedAt).toLocaleString()}
                      </div>
                    </div>
                    <div style={{ textAlign:'center', minWidth:48 }}>
                      <div style={{ fontWeight:700, color: gradeColor(entry.grade), fontSize:'1.3rem', lineHeight:1 }}>{entry.grade}</div>
                      <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginTop:2 }}>{entry.healthScore}/100</div>
                    </div>
                    <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', whiteSpace:'nowrap' }}>{entry.pagesCrawled} pages</div>
                    <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                      <span style={{ padding:'2px 6px', borderRadius:3, fontSize:'0.7rem', fontWeight:600, background:'rgba(247,85,85,.15)', color:'#f75555' }}>{entry.issueCount.critical} crit</span>
                      <span style={{ padding:'2px 6px', borderRadius:3, fontSize:'0.7rem', fontWeight:600, background:'rgba(245,166,35,.15)', color:'#f5a623' }}>{entry.issueCount.warning} warn</span>
                    </div>
                    <span style={{ fontSize:'0.73rem', color:'var(--text-muted)', textTransform:'capitalize', whiteSpace:'nowrap' }}>{entry.crawlMode}</span>
                    <button
                      className="btn-secondary"
                      style={{ fontSize:'0.75rem', padding:'4px 12px', whiteSpace:'nowrap', opacity: isLoading ? 0.6 : 1 }}
                      onClick={e => { e.stopPropagation(); loadHistoryEntry(entry.jobId, entry.url); }}
                      disabled={isLoading}>
                      {isLoading ? 'Loading…' : 'View Report →'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      default:
        return <EmptyState msg="Select a tab to view audit results." />;
    }
  }
}
