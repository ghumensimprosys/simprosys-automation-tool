import type { Page } from 'playwright';
import type {
  PerformanceResult, ResourceBreakdown, RenderBlockingResource,
  OversizedImage, AuditIssue,
} from '@/types/audit';

export async function runPerformanceAudit(page: Page): Promise<PerformanceResult> {
  const data = await page.evaluate(() => {
    // ─── Navigation timing ────────────────────────────────────────────────────
    const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    const nav = navEntries[0];

    const loadTimeMs              = nav ? Math.round(nav.loadEventEnd - nav.startTime)              : 0;
    const domContentLoadedMs      = nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime)  : 0;
    const domInteractiveMs        = nav ? Math.round(nav.domInteractive - nav.startTime)            : 0;

    // ─── Paint timing (FCP, LCP) ──────────────────────────────────────────────
    let firstContentfulPaintMs = 0;
    for (const entry of performance.getEntriesByType('paint')) {
      if (entry.name === 'first-contentful-paint') {
        firstContentfulPaintMs = Math.round(entry.startTime);
        break;
      }
    }

    let largestContentfulPaintMs = 0;
    const lcpEntries = performance.getEntriesByType('largest-contentful-paint') as PerformanceEntry[];
    if (lcpEntries.length > 0) {
      largestContentfulPaintMs = Math.round(lcpEntries[lcpEntries.length - 1].startTime);
    }

    // ─── Long tasks (TBT proxy) ───────────────────────────────────────────────
    let totalBlockingTimeMs = 0;
    for (const entry of performance.getEntriesByType('longtask') as PerformanceMeasure[]) {
      if (entry.duration > 50) totalBlockingTimeMs += Math.round(entry.duration - 50);
    }

    // ─── Resource breakdown ───────────────────────────────────────────────────
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const breakdown = { jsBytes: 0, cssBytes: 0, imageBytes: 0, fontBytes: 0, otherBytes: 0, totalBytes: 0 };
    let resourceCount = 0;

    for (const r of resources) {
      const size = r.transferSize || 0;
      breakdown.totalBytes += size;
      resourceCount++;
      const url = r.name.toLowerCase();
      if (/\.js(\?|$)/.test(url) || r.initiatorType === 'script')       breakdown.jsBytes   += size;
      else if (/\.css(\?|$)/.test(url) || r.initiatorType === 'css')    breakdown.cssBytes  += size;
      else if (/\.(png|jpg|jpeg|gif|svg|webp|avif|ico)(\?|$)/.test(url) || r.initiatorType === 'img') breakdown.imageBytes += size;
      else if (/\.(woff|woff2|ttf|eot|otf)(\?|$)/.test(url))           breakdown.fontBytes += size;
      else                                                                breakdown.otherBytes += size;
    }

    // ─── Render-blocking resources ────────────────────────────────────────────
    const renderBlocking: Array<{ url: string; type: 'stylesheet' | 'script'; sizeBytes: number }> = [];
    for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('head link[rel="stylesheet"]'))) {
      if (!link.href) continue;
      const res = resources.find(r => r.name === link.href);
      renderBlocking.push({ url: link.href, type: 'stylesheet', sizeBytes: res?.transferSize || 0 });
    }
    for (const script of Array.from(document.querySelectorAll<HTMLScriptElement>('head script[src]'))) {
      if (!script.src || script.defer || script.async || script.type === 'module') continue;
      const res = resources.find(r => r.name === script.src);
      renderBlocking.push({ url: script.src, type: 'script', sizeBytes: res?.transferSize || 0 });
    }

    // ─── Oversized images ─────────────────────────────────────────────────────
    const oversized: Array<{
      src: string; naturalWidth: number; naturalHeight: number;
      displayWidth: number; displayHeight: number; estimatedWastedBytes: number;
    }> = [];
    for (const img of Array.from(document.querySelectorAll<HTMLImageElement>('img'))) {
      const nw = img.naturalWidth, nh = img.naturalHeight;
      const dw = img.clientWidth,  dh = img.clientHeight;
      if (nw === 0 || dw === 0) continue;
      if (nw > dw * 1.5 || nh > dh * 1.5) {
        const displayPixels = dw * dh;
        const naturalPixels = nw * nh;
        const wastedRatio   = Math.max(0, (naturalPixels - displayPixels) / naturalPixels);
        const res = resources.find(r => r.name === img.src);
        const estimatedWastedBytes = Math.round((res?.transferSize || 0) * wastedRatio);
        if (estimatedWastedBytes > 10_000) {
          oversized.push({ src: img.src, naturalWidth: nw, naturalHeight: nh, displayWidth: dw, displayHeight: dh, estimatedWastedBytes });
        }
      }
    }

    return {
      loadTimeMs, domContentLoadedMs, domInteractiveMs,
      firstContentfulPaintMs, largestContentfulPaintMs, totalBlockingTimeMs,
      breakdown, resourceCount, renderBlocking, oversized,
    };
  });

  // ─── Build issues ─────────────────────────────────────────────────────────────
  const issues: AuditIssue[] = [];
  const add = (
    id: string, severity: AuditIssue['severity'],
    title: string, description: string, extras: Partial<AuditIssue> = {},
  ) => issues.push({ id, severity, category: 'performance', title, description, ...extras });

  if (data.loadTimeMs > 5000) {
    add('perf-slow-load', 'critical', 'Page load time exceeds 5s',
      `Page took ${(data.loadTimeMs / 1000).toFixed(1)}s to load. Target: under 3s.`,
      { value: `${(data.loadTimeMs / 1000).toFixed(1)}s` });
  } else if (data.loadTimeMs > 3000) {
    add('perf-slow-load', 'warning', 'Page load time exceeds 3s',
      `Page took ${(data.loadTimeMs / 1000).toFixed(1)}s to load. Target: under 3s.`,
      { value: `${(data.loadTimeMs / 1000).toFixed(1)}s` });
  }

  if (data.largestContentfulPaintMs > 4000) {
    add('perf-poor-lcp', 'critical', 'Poor Largest Contentful Paint (LCP)',
      `LCP is ${(data.largestContentfulPaintMs / 1000).toFixed(1)}s. Google recommends under 2.5s.`,
      { value: `${(data.largestContentfulPaintMs / 1000).toFixed(1)}s` });
  } else if (data.largestContentfulPaintMs > 2500) {
    add('perf-needs-improvement-lcp', 'warning', 'LCP needs improvement',
      `LCP is ${(data.largestContentfulPaintMs / 1000).toFixed(1)}s. Target: under 2.5s.`,
      { value: `${(data.largestContentfulPaintMs / 1000).toFixed(1)}s` });
  }

  if (data.totalBlockingTimeMs > 600) {
    add('perf-high-tbt', 'critical', 'High Total Blocking Time',
      `TBT is ${data.totalBlockingTimeMs}ms. Target: under 200ms. Long JS tasks block the main thread.`,
      { value: `${data.totalBlockingTimeMs}ms` });
  } else if (data.totalBlockingTimeMs > 200) {
    add('perf-moderate-tbt', 'warning', 'Total Blocking Time needs improvement',
      `TBT is ${data.totalBlockingTimeMs}ms. Target: under 200ms.`,
      { value: `${data.totalBlockingTimeMs}ms` });
  }

  const totalKB = data.breakdown.totalBytes / 1024;
  if (totalKB > 3000) {
    add('perf-large-page', 'warning', 'Page weight exceeds 3MB',
      `Total page transfer size is ${Math.round(totalKB)}KB. Heavy pages hurt mobile performance.`,
      { value: `${Math.round(totalKB)}KB` });
  }

  if (data.breakdown.jsBytes > 1_000_000) {
    add('perf-large-js', 'warning', 'Large JavaScript bundle',
      `JavaScript transfer size is ${Math.round(data.breakdown.jsBytes / 1024)}KB. Aim for under 300KB.`,
      { value: `${Math.round(data.breakdown.jsBytes / 1024)}KB` });
  }

  if (data.renderBlocking.length > 3) {
    add('perf-render-blocking', 'warning', 'Multiple render-blocking resources',
      `${data.renderBlocking.length} render-blocking resources delay first paint. Add async/defer to scripts and use font-display: swap.`,
      { value: `${data.renderBlocking.length} resources` });
  } else if (data.renderBlocking.length > 0) {
    add('perf-render-blocking', 'info', 'Render-blocking resources detected',
      `${data.renderBlocking.length} render-blocking resource(s) may delay first paint.`,
      { value: `${data.renderBlocking.length} resources` });
  }

  if (data.oversized.length > 0) {
    const totalWasted = data.oversized.reduce((s, i) => s + i.estimatedWastedBytes, 0);
    add('perf-oversized-images', 'warning', 'Oversized images',
      `${data.oversized.length} image(s) are larger than their display size (~${Math.round(totalWasted / 1024)}KB wasted). Resize images to display dimensions.`,
      { value: `${data.oversized.length} images` });
  }

  return {
    loadTimeMs: data.loadTimeMs,
    domContentLoadedMs: data.domContentLoadedMs,
    domInteractiveMs: data.domInteractiveMs,
    firstContentfulPaintMs: data.firstContentfulPaintMs,
    largestContentfulPaintMs: data.largestContentfulPaintMs,
    timeToInteractiveMs: data.domInteractiveMs,
    totalBlockingTimeMs: data.totalBlockingTimeMs,
    resourceBreakdown: data.breakdown as ResourceBreakdown,
    resourceCount: data.resourceCount,
    renderBlocking: data.renderBlocking as RenderBlockingResource[],
    oversizedImages: data.oversized as OversizedImage[],
    issues,
  };
}
