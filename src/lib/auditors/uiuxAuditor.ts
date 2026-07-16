import type { Page } from 'playwright';
import type { UiUxResult, OverflowElement, TapTarget, AuditIssue } from '@/types/audit';

export async function runUiUxAudit(page: Page): Promise<UiUxResult> {
  const data = await page.evaluate(() => {
    // ─── Horizontal overflow ───────────────────────────────────────────────────
    const overflowElements: Array<{ selector: string; scrollWidth: number; clientWidth: number; overflowPx: number }> = [];
    const bodyWidth = document.body.scrollWidth;
    const viewportWidth = window.innerWidth;

    if (bodyWidth > viewportWidth + 5) {
      // Find the elements causing overflow
      const all = document.querySelectorAll('*');
      for (const el of Array.from(all).slice(0, 500)) {
        const rect = el.getBoundingClientRect();
        if (rect.right > viewportWidth + 5) {
          const tag = el.tagName.toLowerCase();
          const id = el.id ? `#${el.id}` : '';
          const cls = el.className && typeof el.className === 'string'
            ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
            : '';
          overflowElements.push({
            selector: `${tag}${id}${cls}`,
            scrollWidth: (el as HTMLElement).scrollWidth,
            clientWidth: (el as HTMLElement).clientWidth,
            overflowPx: Math.round(rect.right - viewportWidth),
          });
          if (overflowElements.length >= 5) break;
        }
      }
    }

    // ─── Small tap targets ─────────────────────────────────────────────────────
    const MIN_SIZE = 44; // px — WCAG 2.5.5 recommended minimum
    const tapTargetFailures: Array<{ selector: string; text: string; widthPx: number; heightPx: number }> = [];
    const interactiveEls = document.querySelectorAll<HTMLElement>(
      'button, a[href], input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"], select',
    );
    for (const el of Array.from(interactiveEls).slice(0, 200)) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
        const text = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 60);
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        tapTargetFailures.push({
          selector: `${tag}${id}`,
          text,
          widthPx: Math.round(rect.width),
          heightPx: Math.round(rect.height),
        });
        if (tapTargetFailures.length >= 10) break;
      }
    }

    // ─── CTA above fold ────────────────────────────────────────────────────────
    const CTA_PATTERNS = /\b(buy|shop|get started|start free|sign up|subscribe|order|checkout|add to cart|try|demo|contact us|book|schedule|download|install)\b/i;
    const allEls = Array.from(document.querySelectorAll<HTMLElement>('a, button, input[type="submit"]'));
    const ctaElements: string[] = [];
    let ctaAboveFold = false;
    const viewportHeight = window.innerHeight;

    for (const el of allEls.slice(0, 100)) {
      const text = (el.textContent || (el as HTMLInputElement).value || el.getAttribute('aria-label') || '').trim();
      if (CTA_PATTERNS.test(text)) {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        ctaElements.push(`${tag}${id}: "${text.slice(0, 40)}"`);
        const rect = el.getBoundingClientRect();
        if (rect.top < viewportHeight && rect.bottom > 0) ctaAboveFold = true;
      }
    }

    // ─── Hidden important elements ─────────────────────────────────────────────
    const hiddenImportant: Array<{ selector: string; reason: string }> = [];
    const importantSelectors = [
      { sel: 'nav', label: 'navigation' },
      { sel: 'header', label: 'header' },
      { sel: 'footer', label: 'footer' },
      { sel: 'main', label: 'main content' },
      { sel: 'form', label: 'form' },
    ];
    for (const { sel, label } of importantSelectors) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) continue;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        hiddenImportant.push({ selector: sel, reason: `${label} is hidden (display/visibility/opacity)` });
      }
    }

    return { overflowElements, tapTargetFailures, ctaAboveFold, ctaElements, hiddenImportant };
  });

  // ─── Build issues ──────────────────────────────────────────────────────────
  const issues: AuditIssue[] = [];
  const add = (
    id: string, severity: AuditIssue['severity'],
    title: string, description: string, extras: Partial<AuditIssue> = {},
  ) => issues.push({ id, severity, category: 'uiux', title, description, ...extras });

  if (data.overflowElements.length > 0) {
    add('uiux-horizontal-overflow', 'critical', 'Horizontal scroll on mobile',
      `${data.overflowElements.length} element(s) extend beyond the viewport width, causing horizontal scroll. This breaks mobile layout.`,
      { element: data.overflowElements[0]?.selector, value: `${data.overflowElements[0]?.overflowPx}px overflow` });
  }

  if (data.tapTargetFailures.length > 5) {
    add('uiux-small-tap-targets', 'warning', 'Many tap targets are too small',
      `${data.tapTargetFailures.length} interactive elements are smaller than 44×44px. This makes them hard to tap on mobile.`,
      { value: `${data.tapTargetFailures.length} elements` });
  } else if (data.tapTargetFailures.length > 0) {
    add('uiux-small-tap-targets', 'info', 'Some tap targets may be too small',
      `${data.tapTargetFailures.length} interactive element(s) are smaller than 44×44px.`,
      { value: `${data.tapTargetFailures.length} elements` });
  }

  if (!data.ctaAboveFold && data.ctaElements.length === 0) {
    add('uiux-no-cta', 'warning', 'No call-to-action detected',
      'No clear call-to-action button was found on the page. Every page should guide visitors toward a next step.');
  } else if (!data.ctaAboveFold && data.ctaElements.length > 0) {
    add('uiux-cta-below-fold', 'info', 'Primary CTA is below the fold',
      'A CTA was found but not visible above the fold. Consider moving your primary CTA higher on the page.');
  }

  for (const hidden of data.hiddenImportant) {
    add(`uiux-hidden-${hidden.selector}`, 'warning',
      `Important element is hidden: ${hidden.selector}`,
      hidden.reason,
      { element: hidden.selector });
  }

  return {
    overflowElements: data.overflowElements as OverflowElement[],
    tapTargetFailures: data.tapTargetFailures as TapTarget[],
    ctaAboveFold: data.ctaAboveFold,
    ctaElements: data.ctaElements,
    hiddenImportantElements: data.hiddenImportant,
    issues,
  };
}
