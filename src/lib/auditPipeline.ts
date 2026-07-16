/**
 * src/lib/auditPipeline.ts
 *
 * Audit pipeline orchestrator. Called by /api/audit/start.
 *
 * Phase 1  — Crawl     (BFS URL discovery, robots.txt, sitemap)
 * Phase 2  — Per-page  (SEO, a11y, perf, security, UX, content, tech, functional)
 * Phase 3  — Visual AI (gemma4 screenshots)
 * Phase 4  — AI recommendations (qwen2.5-coder)
 * Phase 5  — QA test case generation
 * Phase 6  — Playwright + fix generation
 * Phase 7  — Scoring + history persistence
 */

import type {
  AuditConfig, AuditJob, SiteAuditResult, PageAuditResult,
  CrawlSummary, SiteWideAnalysis, DuplicateGroup,
} from '@/types/audit';

import { updateJob, setJobStatus, failJob, storeResult } from './auditJobManager';
import { emitEvent, closeJobStream } from './auditEventBus';
import { saveResult, appendHistoryEntry, buildIndexEntry } from './auditHistory';
import { launchBrowser, createAuditPage, navigateTo, takeScreenshot, VIEWPORTS } from './browserManager';
import { normalizeUrl, fetchRobotsTxt, fetchSitemapUrls, isSameOrigin, isDisallowedByRobots, isStaticAsset, resolveUrl } from './urlUtils';
import { computePageScore, computeSiteHealthScore } from './scoringEngine';

import { runSeoAudit } from './auditors/seoAuditor';
import { runAccessibilityAudit } from './auditors/accessibilityAuditor';
import { runVisualAudit } from './auditors/visualAuditor';
import { generateRecommendations } from './aiGenerators/recommendationGenerator';
import { generateQaTestCases } from './aiGenerators/qaTestGenerator';
import { generatePlaywrightSuite } from './aiGenerators/playwrightGenerator';
import { generateFixes } from './aiGenerators/fixGenerator';
import { runPerformanceAudit } from './auditors/performanceAuditor';
import { runSecurityAudit } from './auditors/securityAuditor';
import { runUiUxAudit } from './auditors/uiuxAuditor';
import { runContentAudit } from './auditors/contentAuditor';
import { runTechAudit } from './auditors/techAuditor';
import { runFunctionalAudit } from './auditors/functionalAuditor';

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function runAuditJob(job: AuditJob): Promise<void> {
  const { jobId, config } = job;
  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;

  try {
    // ─── Phase: Crawl ────────────────────────────────────────────────────────
    setJobStatus(jobId, 'crawling', 'crawl', 'Crawling website…', 5);
    emitEvent(jobId, { type: 'phase_start', phase: 'crawl', phaseLabel: 'Crawling website…', totalProgress: 5 });

    browser = await launchBrowser();
    const { crawledPages, crawlSummary } = await crawlSite(jobId, config, browser);

    emitEvent(jobId, { type: 'phase_complete', phase: 'crawl', phaseLabel: 'Crawl complete', totalProgress: 20 });

    // ─── Phase: Per-page audit ───────────────────────────────────────────────
    setJobStatus(jobId, 'auditing', 'audit', 'Auditing pages…', 20);
    emitEvent(jobId, { type: 'phase_start', phase: 'audit', phaseLabel: 'Auditing pages…', totalProgress: 20 });

    const pageResults: PageAuditResult[] = [];
    for (let i = 0; i < crawledPages.length; i++) {
      const pageUrl = crawledPages[i];
      const isHomepage = i === 0;
      const pageProgress = 20 + Math.round((i / crawledPages.length) * 50);

      emitEvent(jobId, { type: 'page_start', url: pageUrl, pageIndex: i, totalPages: crawledPages.length });
      updateJob(jobId, {
        totalProgress: pageProgress,
        crawlProgress: { ...job.crawlProgress, crawled: i + 1, currentUrl: pageUrl },
      });

      const pageResult = await auditPage(pageUrl, browser, {
        isHomepage,
        categories: config.categories,
        robotsTxtFound: crawlSummary.robotsTxtFound,
        robotsTxtDisallowed: crawlSummary.robotsTxtDisallowed,
        sitemapUrl: crawlSummary.sitemapUrl,
      });

      // Emit any critical/warning issues found
      for (const issue of pageResult.issues) {
        if (issue.severity !== 'info') {
          emitEvent(jobId, { type: 'issue_found', issue, pageUrl });
        }
      }

      pageResults.push(pageResult);

      emitEvent(jobId, {
        type: 'page_complete',
        url: pageUrl,
        pageIndex: i,
        pageScore: pageResult.pageScore,
        issueCount: {
          critical: pageResult.issues.filter(i => i.severity === 'critical').length,
          warning:  pageResult.issues.filter(i => i.severity === 'warning').length,
          info:     pageResult.issues.filter(i => i.severity === 'info').length,
        },
      });
    }

    emitEvent(jobId, { type: 'phase_complete', phase: 'audit', phaseLabel: 'Audit complete', totalProgress: 70 });

    // ─── Phase 3: Visual AI (homepage only) ───────────────────────────────────
    if (config.categories.includes('visual') && pageResults.length > 0 && pageResults[0].screenshots.desktop) {
      setJobStatus(jobId, 'generating', 'visual', 'Running visual AI analysis…', 72);
      emitEvent(jobId, { type: 'phase_start', phase: 'visual', phaseLabel: 'Visual AI analysis…', totalProgress: 72 });
      try {
        const visualResult = await runVisualAudit({
          url: pageResults[0].url,
          browser: browser!,
          desktopScreenshot: pageResults[0].screenshots.desktop,
          captureMobile: true,
        });
        pageResults[0].visualAnalysis = visualResult;
        pageResults[0].screenshots.mobile = visualResult.mobileLayoutScore !== null
          ? (pageResults[0].screenshots.mobile ?? null)
          : null;
        // Add visual issues to page issues
        const visualIssues = visualResult.visualIssues.map(vi => ({
          id: vi.id,
          severity: vi.severity,
          category: 'visual' as const,
          title: vi.description.slice(0, 80),
          description: vi.description,
        }));
        pageResults[0].issues.push(...visualIssues);
      } catch { /* visual AI is optional — never crash the audit */ }
      emitEvent(jobId, { type: 'phase_complete', phase: 'visual', phaseLabel: 'Visual AI complete', totalProgress: 76 });
    }

    // ─── Phase 4–6: AI text generation (recommendations, QA, Playwright, fixes)
    setJobStatus(jobId, 'generating', 'ai', 'Generating AI insights…', 76);
    emitEvent(jobId, { type: 'phase_start', phase: 'ai', phaseLabel: 'Generating AI insights…', totalProgress: 76 });

    const siteWideForAi = buildSiteWideAnalysis(pageResults);
    const techStack = pageResults[0]?.tech ?? null;
    const hasForms = pageResults.some(p => (p.functional?.formsWithoutAction ?? 0) >= 0);
    const hasEcommerce = !!techStack?.ecommerce;

    const [recommendations, qaTestCases] = await Promise.all([
      generateRecommendations({
        siteUrl: config.url,
        issues: siteWideForAi.uniqueIssues,
        techStack,
        totalPages: pageResults.length,
        avgLoadTimeMs: siteWideForAi.averageLoadTimeMs,
      }).catch(() => []),
      generateQaTestCases({
        siteUrl: config.url,
        pages: pageResults.map(p => ({ url: p.url, title: p.title, seo: p.seo })),
        issues: siteWideForAi.uniqueIssues,
        hasForms,
        hasEcommerce,
      }).catch(() => []),
    ]);

    setJobStatus(jobId, 'generating', 'playwright', 'Generating Playwright tests…', 85);
    emitEvent(jobId, { type: 'phase_start', phase: 'playwright', phaseLabel: 'Generating Playwright tests…', totalProgress: 85 });

    const [playwrightSuite, fixes] = await Promise.all([
      generatePlaywrightSuite({
        siteUrl: config.url,
        crawlMode: config.crawlMode,
        qaTestCases,
        criticalIssues: siteWideForAi.uniqueIssues.filter(i => i.severity === 'critical'),
        hasForms,
        hasEcommerce,
      }).catch(() => null),
      generateFixes({
        issues: siteWideForAi.uniqueIssues,
        techStack,
        siteUrl: config.url,
      }).catch(() => []),
    ]);

    emitEvent(jobId, { type: 'phase_complete', phase: 'ai', phaseLabel: 'AI complete', totalProgress: 90 });

    // ─── Phase: Score + persist ───────────────────────────────────────────────
    setJobStatus(jobId, 'complete', 'complete', 'Finalising…', 90);

    const siteWide = buildSiteWideAnalysis(pageResults);
    const healthScore = computeSiteHealthScore(pageResults, siteWide);

    const result: SiteAuditResult = {
      jobId,
      config,
      auditedAt: Date.now(),
      durationMs: Date.now() - job.startedAt,
      crawlSummary,
      healthScore,
      pages: pageResults,
      siteWide,
      recommendations,
      qaTestCases,
      playwrightSuite: playwrightSuite ?? null,
      fixes,
    };

    storeResult(jobId, result);
    saveResult(result);
    appendHistoryEntry(buildIndexEntry(result));

    setJobStatus(jobId, 'complete', 'complete', 'Audit complete', 100);
    closeJobStream(jobId, {
      type: 'complete',
      healthScore: healthScore.overall,
      grade: healthScore.grade,
      durationMs: result.durationMs,
      pagesCrawled: pageResults.length,
      issueCount: siteWide.issueCount,
    });

  } catch (err: any) {
    const message = err?.message || 'Unknown error';
    failJob(jobId, message);
    closeJobStream(jobId, { type: 'error', message });
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

// ─── Crawl engine ─────────────────────────────────────────────────────────────

interface CrawlResult {
  crawledPages: string[];
  crawlSummary: CrawlSummary;
}

async function crawlSite(
  jobId: string,
  config: AuditConfig,
  browser: Awaited<ReturnType<typeof launchBrowser>>,
): Promise<CrawlResult> {
  const startTime = Date.now();
  const { url: startUrl, crawlMode, maxPages, crawlDelayMs } = config;

  const robots = await fetchRobotsTxt(startUrl);

  let sitemapUrl = robots.sitemapUrls[0] || '';
  let sitemapPageCount = 0;
  if (sitemapUrl) {
    try { sitemapPageCount = (await fetchSitemapUrls(sitemapUrl, maxPages * 2)).length; } catch {}
  }

  if (crawlMode === 'single') {
    const normalised = normalizeUrl(startUrl) || startUrl;
    return {
      crawledPages: [normalised],
      crawlSummary: {
        mode: crawlMode,
        pagesDiscovered: 1, pagesCrawled: 1, pagesErrored: 0,
        crawlDurationMs: Date.now() - startTime,
        sitemapFound: !!sitemapUrl, sitemapUrl, sitemapPageCount,
        robotsTxtFound: robots.found, robotsTxtContent: robots.content,
        robotsTxtDisallowed: robots.disallowedPaths, crawlDelayUsedMs: 0,
      },
    };
  }

  // BFS
  const visited = new Set<string>();
  const queue: string[] = [normalizeUrl(startUrl) || startUrl];
  const discovered = new Set<string>(queue);
  let errored = 0;

  const effectiveDelay = robots.crawlDelay
    ? Math.max(crawlDelayMs, robots.crawlDelay * 1000)
    : crawlDelayMs;

  while (queue.length > 0 && visited.size < maxPages) {
    const pageUrl = queue.shift()!;
    if (visited.has(pageUrl)) continue;
    if (isDisallowedByRobots(pageUrl, robots.disallowedPaths)) continue;

    visited.add(pageUrl);
    emitEvent(jobId, {
      type: 'crawl_progress',
      discovered: discovered.size, crawled: visited.size,
      queued: queue.length, errored, currentUrl: pageUrl,
    });

    try {
      const { page, close } = await createAuditPage(browser);
      try {
        const nav = await navigateTo(page, pageUrl);
        if (nav.statusCode >= 400) { errored++; continue; }

        const links: string[] = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]'))
            .map(a => (a as HTMLAnchorElement).href)
            .filter(h => h.startsWith('http')),
        );

        for (const link of links) {
          const normalized = resolveUrl(link, pageUrl);
          if (!normalized) continue;
          if (!isSameOrigin(normalized, startUrl)) continue;
          if (isStaticAsset(normalized)) continue;
          if (!discovered.has(normalized)) {
            discovered.add(normalized);
            queue.push(normalized);
          }
        }
      } finally {
        await close();
      }
    } catch { errored++; }

    if (effectiveDelay > 0 && queue.length > 0) {
      await new Promise(r => setTimeout(r, effectiveDelay));
    }
  }

  return {
    crawledPages: Array.from(visited),
    crawlSummary: {
      mode: crawlMode,
      pagesDiscovered: discovered.size, pagesCrawled: visited.size, pagesErrored: errored,
      crawlDurationMs: Date.now() - startTime,
      sitemapFound: !!sitemapUrl, sitemapUrl, sitemapPageCount,
      robotsTxtFound: robots.found, robotsTxtContent: robots.content,
      robotsTxtDisallowed: robots.disallowedPaths, crawlDelayUsedMs: effectiveDelay,
    },
  };
}

// ─── Per-page audit ───────────────────────────────────────────────────────────

interface PageAuditOptions {
  isHomepage: boolean;
  categories: string[];
  robotsTxtFound?: boolean;
  robotsTxtDisallowed?: string[];
  sitemapUrl?: string;
}

async function auditPage(
  url: string,
  browser: Awaited<ReturnType<typeof launchBrowser>>,
  opts: PageAuditOptions,
): Promise<PageAuditResult> {
  const { page, close, consoleErrors } = await createAuditPage(browser, VIEWPORTS.desktop);

  try {
    const nav = await navigateTo(page, url);

    // Fetch response headers server-side for security + tech checks
    let responseHeaders: Record<string, string> = {};
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(5000) });
      res.headers.forEach((val, key) => { responseHeaders[key.toLowerCase()] = val; });
    } catch {}

    // Desktop screenshot
    const desktopScreenshot = await takeScreenshot(page, false) ?? '';

    // ─── Run all auditors ──────────────────────────────────────────────────
    const [seo, accessibility, performance, uiux, content, functional] = await Promise.all([
      runSeoAudit(page, {
        pageUrl: url,
        isHomepage: opts.isHomepage,
        robotsTxtFound: opts.robotsTxtFound,
        robotsTxtDisallowed: opts.robotsTxtDisallowed,
        sitemapUrl: opts.sitemapUrl,
      }),
      opts.categories.includes('accessibility')
        ? runAccessibilityAudit(page).catch(() => null)
        : Promise.resolve(null),
      opts.categories.includes('performance')
        ? runPerformanceAudit(page).catch(() => null)
        : Promise.resolve(null),
      opts.categories.includes('uiux')
        ? runUiUxAudit(page).catch(() => null)
        : Promise.resolve(null),
      opts.categories.includes('content')
        ? runContentAudit(page).catch(() => null)
        : Promise.resolve(null),
      opts.categories.includes('functional')
        ? runFunctionalAudit(page, { pageUrl: url }).catch(() => null)
        : Promise.resolve(null),
    ]);

    // Security + tech only on homepage (one-time checks)
    const security = (opts.isHomepage && opts.categories.includes('security'))
      ? await runSecurityAudit(page, { url, responseHeaders }).catch(() => null)
      : null;

    const tech = (opts.isHomepage && opts.categories.includes('tech'))
      ? await runTechAudit(page, { responseHeaders }).catch(() => null)
      : null;

    // Consolidate all issues
    const allIssues = [
      ...seo.issues,
      ...(accessibility?.issues ?? []),
      ...(performance?.issues ?? []),
      ...(security?.issues ?? []),
      ...(uiux?.issues ?? []),
      ...(content?.issues ?? []),
      ...(functional?.issues ?? []),
    ];

    const result: PageAuditResult = {
      url,
      title: seo.title,
      statusCode: nav.statusCode,
      redirectChain: nav.redirectChain,
      loadTimeMs: nav.loadTimeMs,
      auditDepth: 'full',
      pageScore: 0,
      screenshots: { desktop: desktopScreenshot, mobile: null, tablet: null },
      seo,
      accessibility,
      performance,
      security,
      uiux,
      content,
      tech,
      functional,
      visualAnalysis: null,
      consoleErrors,
      issues: allIssues,
    };

    result.pageScore = computePageScore(result);
    return result;

  } finally {
    await close();
  }
}

// ─── Site-wide aggregation ────────────────────────────────────────────────────

function buildSiteWideAnalysis(pages: PageAuditResult[]): SiteWideAnalysis {
  // Duplicate title detection
  const titleMap = new Map<string, string[]>();
  const descMap  = new Map<string, string[]>();
  for (const p of pages) {
    const t = p.seo.title.trim().toLowerCase();
    if (t) titleMap.set(t, [...(titleMap.get(t) ?? []), p.url]);
    const d = p.seo.description.trim().toLowerCase();
    if (d) descMap.set(d, [...(descMap.get(d) ?? []), p.url]);
  }
  const duplicateTitles: DuplicateGroup[] = Array.from(titleMap.entries())
    .filter(([, urls]) => urls.length > 1)
    .map(([value, pageUrls]) => ({ value, pages: pageUrls }));
  const duplicateDescriptions: DuplicateGroup[] = Array.from(descMap.entries())
    .filter(([, urls]) => urls.length > 1)
    .map(([value, pageUrls]) => ({ value, pages: pageUrls }));

  // Unique issues (deduplicate by id across pages, attach all affected pages)
  const issueMap = new Map<string, { issue: typeof pages[0]['issues'][0]; pageUrls: string[] }>();
  for (const p of pages) {
    for (const issue of p.issues) {
      if (issueMap.has(issue.id)) {
        issueMap.get(issue.id)!.pageUrls.push(p.url);
      } else {
        issueMap.set(issue.id, { issue: { ...issue }, pageUrls: [p.url] });
      }
    }
  }
  const uniqueIssues = Array.from(issueMap.values()).map(({ issue, pageUrls }) => ({
    ...issue, pages: pageUrls,
  }));

  // Broken links aggregate from all pages
  const allBrokenLinks = pages.flatMap(p => p.functional?.brokenLinks ?? []);
  const allRedirectChains = pages.flatMap(p => p.functional?.redirectChains ?? []);

  const avgLoad = pages.length > 0
    ? Math.round(pages.reduce((s, p) => s + p.loadTimeMs, 0) / pages.length)
    : 0;

  const critical = uniqueIssues.filter(i => i.severity === 'critical').length;
  const warning  = uniqueIssues.filter(i => i.severity === 'warning').length;
  const info     = uniqueIssues.filter(i => i.severity === 'info').length;

  return {
    uniqueIssues,
    duplicateTitles,
    duplicateDescriptions,
    missingTitlePages:       pages.filter(p => !p.seo.title).map(p => p.url),
    missingDescriptionPages: pages.filter(p => !p.seo.description).map(p => p.url),
    missingH1Pages:          pages.filter(p => p.seo.h1Count === 0).map(p => p.url),
    pagesWithoutCanonical:   pages.filter(p => !p.seo.canonical).map(p => p.url),
    nonIndexablePages:       pages.filter(p => !p.seo.isIndexable).map(p => p.url),
    orphanPages:             [], // populated in Phase 2 crawl graph analysis
    brokenLinks:             allBrokenLinks,
    redirectChains:          allRedirectChains,
    averageLoadTimeMs:       avgLoad,
    slowestPages:            [...pages]
      .sort((a, b) => b.loadTimeMs - a.loadTimeMs)
      .slice(0, 5)
      .map(p => ({ url: p.url, loadTimeMs: p.loadTimeMs })),
    issueCount: { critical, warning, info },
  };
}
