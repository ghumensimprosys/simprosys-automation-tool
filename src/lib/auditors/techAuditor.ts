import type { Page } from 'playwright';
import type { TechDetectionResult, TechSignal } from '@/types/audit';

export interface TechAuditOptions {
  responseHeaders: Record<string, string>;
}

export async function runTechAudit(page: Page, opts: TechAuditOptions): Promise<TechDetectionResult> {
  const { responseHeaders } = opts;

  // ─── Browser-side JS globals + DOM signals ────────────────────────────────
  const browserSignals = await page.evaluate(() => {
    const w = (window as unknown) as Record<string, unknown>;
    const signals: Array<{ name: string; confidence: string; evidence: string; version?: string; category: string }> = [];

    const check = (
      name: string, category: string, condition: boolean,
      evidence: string, confidence: 'definite' | 'probable' | 'possible' = 'definite',
      version?: string,
    ) => {
      if (condition) signals.push({ name, category, confidence, evidence, version });
    };

    // JS Frameworks
    check('React', 'framework', !!w.__reactFiber || !!w.React || !!document.querySelector('[data-reactroot]'), 'window.React or React root element');
    check('Vue.js', 'framework', !!w.__vue_app__ || !!w.Vue || !!document.querySelector('[data-v-app]'), 'window.Vue or Vue app root');
    check('Angular', 'framework', !!w.ng || !!document.querySelector('[ng-version]'),
      'window.ng or ng-version attribute',
      'definite', (document.querySelector('[ng-version]')?.getAttribute('ng-version')) || undefined);
    check('Next.js', 'framework', !!w.__NEXT_DATA__, 'window.__NEXT_DATA__',
      'definite', (w.__NEXT_DATA__ as Record<string,unknown>)?.buildId as string | undefined);
    check('Nuxt.js', 'framework', !!w.__NUXT__, 'window.__NUXT__');
    check('Svelte', 'framework', !!document.querySelector('[class^="svelte-"]'), 'Svelte-scoped class names');
    check('Gatsby', 'framework', !!w.___gatsby, 'window.___gatsby');
    check('Remix', 'framework', !!w.__remixContext, 'window.__remixContext');

    // CMS
    check('WordPress', 'cms', !!w.wp || !!document.querySelector('link[href*="wp-content"]'), 'window.wp or /wp-content/ path');
    check('Shopify', 'ecommerce', !!w.Shopify, 'window.Shopify',
      'definite', ((w.Shopify as Record<string, Record<string, string>>)?.theme)?.name || undefined);
    check('WooCommerce', 'ecommerce', !!w.wc_add_to_cart_params || !!w.woocommerce_params, 'WooCommerce JS params');
    check('Webflow', 'framework', !!document.querySelector('html[data-wf-page]'), 'data-wf-page attribute');
    check('Squarespace', 'cms', !!(w.Static as Record<string, unknown>)?.SQUARESPACE_CONTEXT, 'Squarespace context object');
    check('Wix', 'cms', !!document.querySelector('meta[content="Wix.com Website Builder"]'), 'Wix meta tag');

    // Analytics
    check('Google Analytics (GA4)', 'analytics', !!w.gtag || !!w.ga, 'window.gtag or window.ga');
    check('Google Tag Manager', 'analytics', !!w.google_tag_manager || !!w.dataLayer, 'window.google_tag_manager or dataLayer');
    check('Hotjar', 'analytics', !!w.hj, 'window.hj');
    check('Mixpanel', 'analytics', !!w.mixpanel, 'window.mixpanel');
    check('Segment', 'analytics', !!w.analytics, 'window.analytics (Segment pattern)');

    // Libraries
    check('jQuery', 'library', !!w.jQuery || !!((w.$ as Record<string, Record<string,string>>)?.fn?.jquery), 'window.jQuery',
      'definite', ((w.jQuery as Record<string, Record<string, string>>)?.fn)?.jquery || undefined);
    check('Lodash', 'library', !!w._ && !!(w._ as Record<string,unknown>).VERSION, 'window._ with VERSION');
    check('Bootstrap', 'library', !!w.bootstrap || !!document.querySelector('[data-bs-toggle]'), 'Bootstrap JS or data-bs-toggle');

    // Meta generator
    const generator = document.querySelector<HTMLMetaElement>('meta[name="generator"]')?.content;
    if (generator) signals.push({ name: generator, category: 'cms', confidence: 'definite', evidence: 'meta[name="generator"]' });

    return signals;
  });

  // ─── Header-based detection ───────────────────────────────────────────────
  const headerSignals: TechSignal[] = [];
  const h = responseHeaders;

  if (h.server) headerSignals.push({ name: h.server, category: 'server', confidence: 'definite', evidence: `Server: ${h.server}` });
  if (h['x-powered-by']) headerSignals.push({ name: h['x-powered-by'], category: 'server', confidence: 'definite', evidence: `X-Powered-By: ${h['x-powered-by']}` });
  if (h['x-shopify-stage'] || h['x-shopify-request-id']) headerSignals.push({ name: 'Shopify', category: 'ecommerce', confidence: 'definite', evidence: 'Shopify-specific response header' });
  if (h['x-cdn']) headerSignals.push({ name: h['x-cdn'], category: 'cdn', confidence: 'definite', evidence: `X-CDN: ${h['x-cdn']}` });
  if (h['cf-ray']) headerSignals.push({ name: 'Cloudflare', category: 'cdn', confidence: 'definite', evidence: 'CF-Ray header' });
  if (h['x-cache']?.includes('cloudfront') || h['via']?.includes('CloudFront')) {
    headerSignals.push({ name: 'CloudFront', category: 'cdn', confidence: 'definite', evidence: 'CloudFront cache header' });
  }
  if (h['x-vercel-id']) headerSignals.push({ name: 'Vercel', category: 'cdn', confidence: 'definite', evidence: 'x-vercel-id header' });
  if (h['x-netlify']) headerSignals.push({ name: 'Netlify', category: 'cdn', confidence: 'definite', evidence: 'x-netlify header' });

  const allSignals: TechSignal[] = [
    ...browserSignals.map(s => ({
      name: s.name,
      category: s.category as TechSignal['category'],
      confidence: s.confidence as TechSignal['confidence'],
      evidence: s.evidence,
      version: s.version,
    })),
    ...headerSignals,
  ];

  // ─── Summarise into typed fields ───────────────────────────────────────────
  const findFirst = (category: string): string | null =>
    allSignals.find(s => s.category === category)?.name ?? null;

  const findAll = (category: string): string[] =>
    allSignals.filter(s => s.category === category).map(s => s.name);

  return {
    framework: findFirst('framework'),
    cms: findFirst('cms'),
    ecommerce: findFirst('ecommerce'),
    analytics: findAll('analytics'),
    cdn: findFirst('cdn'),
    server: findFirst('server'),
    jsLibraries: findAll('library'),
    detected: allSignals,
  };
}
