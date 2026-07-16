/**
 * src/lib/browserManager.ts
 *
 * Thin wrapper around Playwright browser/context lifecycle for audit tasks.
 * Audit auditors get a pre-configured page; they must not close the browser
 * themselves — the caller owns teardown via the returned cleanup function.
 *
 * Designed for single-use contexts per page: each crawled URL gets a fresh
 * context (so cookies, localStorage, and service workers don't bleed between
 * pages) but shares the same browser process for the life of the audit job.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';

export const AUDIT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SimprosysAudit/1.0';

export const NAV_TIMEOUT  = 30_000;
export const PAGE_TIMEOUT = 20_000;

export interface AuditViewport {
  width: number;
  height: number;
  label: 'desktop' | 'mobile' | 'tablet';
}

export const VIEWPORTS: Record<'desktop' | 'mobile' | 'tablet', AuditViewport> = {
  desktop: { width: 1280, height: 800,  label: 'desktop' },
  mobile:  { width: 390,  height: 844,  label: 'mobile'  },
  tablet:  { width: 768,  height: 1024, label: 'tablet'  },
};

// ─── Browser lifecycle ────────────────────────────────────────────────────────

/** Launch a headless Chromium browser for audit use. */
export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

// ─── Page factory ─────────────────────────────────────────────────────────────

export interface AuditPage {
  page: Page;
  context: BrowserContext;
  /** Captured console errors during page lifetime */
  consoleErrors: string[];
  /** Captured network response map url→statusCode */
  responses: Map<string, number>;
  /** Call when done with this page to free context resources */
  close: () => Promise<void>;
}

/**
 * Create a fresh browser context + page for auditing a single URL.
 * Caller owns the returned `close()` — always call it in a finally block.
 */
export async function createAuditPage(
  browser: Browser,
  viewport: AuditViewport = VIEWPORTS.desktop,
): Promise<AuditPage> {
  const context = await browser.newContext({
    userAgent: AUDIT_UA,
    viewport: { width: viewport.width, height: viewport.height },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();
  page.setDefaultTimeout(PAGE_TIMEOUT);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  const consoleErrors: string[] = [];
  const responses = new Map<string, number>();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text().slice(0, 300));
    }
  });

  page.on('response', res => {
    responses.set(res.url(), res.status());
  });

  const close = async () => {
    try { await context.close(); } catch { /* ignore teardown errors */ }
  };

  return { page, context, consoleErrors, responses, close };
}

// ─── Navigation ───────────────────────────────────────────────────────────────

export interface NavigationResult {
  finalUrl: string;
  statusCode: number;
  redirectChain: string[];
  loadTimeMs: number;
  timedOut: boolean;
}

/**
 * Navigate to a URL with the established 'commit' + domcontentloaded pattern.
 * Returns a NavigationResult — never throws on navigation failure.
 */
export async function navigateTo(page: Page, url: string): Promise<NavigationResult> {
  const startTime = Date.now();
  const redirectChain: string[] = [];
  let statusCode = 0;
  let timedOut = false;

  // Track redirect chain via response events before navigation
  const responseHandler = (res: { url: () => string; status: () => number }) => {
    const s = res.status();
    if (s >= 300 && s < 400) {
      redirectChain.push(res.url());
    }
    // Capture the final status code (last non-redirect response)
    if (s < 300 || s >= 400) {
      statusCode = s;
    }
  };
  page.on('response', responseHandler);

  try {
    await page.goto(url, { waitUntil: 'commit', timeout: NAV_TIMEOUT });
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1500);
  } catch (err: any) {
    if (err?.message?.includes('Timeout')) timedOut = true;
    // Non-fatal — page may still be partially loaded
  } finally {
    page.off('response', responseHandler);
  }

  if (statusCode === 0) statusCode = 200; // fallback if no response events fired

  return {
    finalUrl: page.url(),
    statusCode,
    redirectChain,
    loadTimeMs: Date.now() - startTime,
    timedOut,
  };
}

// ─── Screenshot ───────────────────────────────────────────────────────────────

/**
 * Take a full-page screenshot and return it as a base64-encoded PNG string.
 * Returns null if the screenshot fails.
 */
export async function takeScreenshot(page: Page, fullPage = false): Promise<string | null> {
  try {
    const buf = await page.screenshot({ fullPage, type: 'png' });
    return buf.toString('base64');
  } catch {
    return null;
  }
}

// ─── axe-core injection ───────────────────────────────────────────────────────

/**
 * Inject axe-core from the bundled vendor file and run accessibility checks.
 * The vendor file must exist at /public/vendor/axe.min.js.
 * Returns the raw axe results object or throws if injection fails.
 */
export async function runAxe(page: Page): Promise<Record<string, unknown>> {
  await page.addScriptTag({ path: 'public/vendor/axe.min.js' });
  return page.evaluate(() => {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      (window as any).axe.run(
        document,
        {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'best-practice'] },
          resultTypes: ['violations', 'passes', 'incomplete'],
        },
        (err: Error | null, results: Record<string, unknown>) => {
          if (err) reject(err);
          else resolve(results);
        },
      );
    });
  });
}
