import type { Page } from 'playwright';
import type { FunctionalResult, BrokenLink, DeadButton, RedirectChain, AuditIssue } from '@/types/audit';
import { isSameOrigin, normalizeUrl } from '@/lib/urlUtils';

export interface FunctionalAuditOptions {
  pageUrl: string;
  /** Max links to HEAD-check. Defaults to 20. Set 0 to skip link checking. */
  maxLinksToCheck?: number;
}

export async function runFunctionalAudit(page: Page, opts: FunctionalAuditOptions): Promise<FunctionalResult> {
  const { pageUrl, maxLinksToCheck = 20 } = opts;

  // ─── Extract links, buttons, forms from DOM ───────────────────────────────
  const domData = await page.evaluate((base: string) => {
    // Links
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .map(a => ({ href: a.href, text: (a.textContent || '').trim().slice(0, 80) }))
      .filter(l => l.href.startsWith('http') && !l.href.startsWith('javascript:'))
      .slice(0, 60);

    // Buttons that look dead (no handler, no role, no aria-*)
    const deadButtons: Array<{ selector: string; text: string; reason: string }> = [];
    for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('button')).slice(0, 50)) {
      const text = (btn.textContent || '').trim().slice(0, 60);
      if (!btn.type || btn.type === 'button') {
        // No onclick in HTML, no form, no aria, no data-*
        const hasHandler = btn.onclick || btn.getAttribute('onclick') || btn.getAttribute('data-action') || btn.getAttribute('data-href');
        const isInForm = !!btn.closest('form');
        if (!hasHandler && !isInForm && btn.getAttribute('disabled') === null) {
          const tag = btn.tagName.toLowerCase();
          const id = btn.id ? `#${btn.id}` : '';
          deadButtons.push({ selector: `${tag}${id}`, text, reason: 'Button has no click handler, form, or data-action' });
        }
      }
    }

    // Forms without action
    const formsWithoutAction = Array.from(document.querySelectorAll('form'))
      .filter(f => !f.action || f.action === window.location.href)
      .length;

    return { links, deadButtons, formsWithoutAction };
  }, pageUrl);

  // ─── HEAD-check links for broken status ──────────────────────────────────
  const brokenLinks: BrokenLink[] = [];

  if (maxLinksToCheck > 0) {
    // Limit to same-origin links to avoid external rate-limiting
    const sameOriginLinks = domData.links
      .filter(l => isSameOrigin(l.href, pageUrl))
      .slice(0, maxLinksToCheck);

    const externalLinks = domData.links
      .filter(l => !isSameOrigin(l.href, pageUrl))
      .slice(0, Math.min(5, maxLinksToCheck));

    const toCheck = [...sameOriginLinks, ...externalLinks];

    await Promise.all(toCheck.map(async ({ href, text }) => {
      const normalised = normalizeUrl(href);
      if (!normalised) return;
      try {
        const res = await fetch(normalised, {
          method: 'HEAD',
          redirect: 'follow',
          signal: AbortSignal.timeout(6000),
        });
        if (res.status >= 400) {
          brokenLinks.push({ url: normalised, statusCode: res.status, text, foundOn: pageUrl });
        }
      } catch {
        // Network error counts as broken
        brokenLinks.push({ url: normalised, statusCode: 0, text, foundOn: pageUrl });
      }
    }));
  }

  // ─── Detect redirect chains in collected links ────────────────────────────
  // (redirect chains for the page itself are tracked in navigateTo — here we
  //  just note long same-origin redirect chains from the DOM links)
  const redirectChains: RedirectChain[] = [];
  const linksToTrace = domData.links.filter(l => isSameOrigin(l.href, pageUrl)).slice(0, 10);
  await Promise.all(linksToTrace.map(async ({ href }) => {
    const chain: string[] = [href];
    try {
      let current = href;
      for (let i = 0; i < 5; i++) {
        const res = await fetch(current, {
          method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(4000),
        });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) break;
          const next = location.startsWith('http') ? location : new URL(location, current).href;
          chain.push(next);
          current = next;
        } else {
          if (chain.length > 1) {
            redirectChains.push({
              startUrl: href,
              chain,
              hops: chain.length - 1,
              finalStatusCode: res.status,
            });
          }
          break;
        }
      }
    } catch { /* ignore — not a link-audit concern */ }
  }));

  // ─── Build issues ──────────────────────────────────────────────────────────
  const issues: AuditIssue[] = [];
  const add = (
    id: string, severity: AuditIssue['severity'],
    title: string, description: string, extras: Partial<AuditIssue> = {},
  ) => issues.push({ id, severity, category: 'functional', title, description, ...extras });

  if (brokenLinks.length > 0) {
    add('func-broken-links', 'critical', 'Broken links detected',
      `${brokenLinks.length} link(s) returned 4xx/5xx status or timed out. Broken links harm UX and SEO.`,
      { value: `${brokenLinks.length} broken` });
  }

  const longRedirects = redirectChains.filter(r => r.hops >= 3);
  if (longRedirects.length > 0) {
    add('func-redirect-chain', 'warning', 'Redirect chains detected',
      `${longRedirects.length} link(s) have 3 or more redirect hops. Long chains slow page load and waste crawl budget.`,
      { value: `${longRedirects.length} chains` });
  }

  if (domData.formsWithoutAction > 0) {
    add('func-form-no-action', 'warning', 'Forms without action attribute',
      `${domData.formsWithoutAction} form(s) have no action attribute, which may cause them to submit back to the current URL unintentionally.`,
      { value: `${domData.formsWithoutAction} forms` });
  }

  return {
    brokenLinks,
    deadButtons: domData.deadButtons as DeadButton[],
    redirectChains,
    formsWithoutAction: domData.formsWithoutAction,
    issues,
  };
}
