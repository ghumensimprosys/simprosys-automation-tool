import type { Page } from 'playwright';
import type {
  PageSeoResult, AuditIssue, HeadingEntry, SchemaEntry,
  OpenGraphData, TwitterData,
} from '@/types/audit';
import { normalizeUrl, fetchSitemapUrls } from '@/lib/urlUtils';

export interface SeoAuditOptions {
  pageUrl: string;
  isHomepage: boolean;
  robotsTxtFound?: boolean;
  robotsTxtDisallowed?: string[];
  sitemapUrl?: string;
}

export async function runSeoAudit(page: Page, opts: SeoAuditOptions): Promise<PageSeoResult> {
  const data = await page.evaluate((baseUrl: string) => {
    const getMeta = (...selectors: string[]): string => {
      for (const sel of selectors) {
        const el = document.querySelector<HTMLMetaElement>(sel);
        if (el?.content) return el.content.trim();
      }
      return '';
    };
    const getLinkHref = (rel: string): string =>
      (document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)?.href) || '';

    const title = document.title.trim();
    const description = getMeta('meta[name="description"]', 'meta[property="og:description"]');
    const keywords    = getMeta('meta[name="keywords"]');
    const robots      = getMeta('meta[name="robots"]');
    const viewport    = getMeta('meta[name="viewport"]');
    const canonical   = getLinkHref('canonical');
    const lang        = document.documentElement.lang?.trim() || '';
    const charset     = document.characterSet?.trim() || '';

    const headings: HeadingEntry[] = Array.from(
      document.querySelectorAll('h1,h2,h3,h4,h5,h6'),
    ).slice(0, 80).map(h => ({
      level: parseInt(h.tagName[1]) as HeadingEntry['level'],
      text: (h.textContent || '').trim().slice(0, 140),
    })).filter(h => h.text.length > 0);

    const og: OpenGraphData = {
      title:       getMeta('meta[property="og:title"]'),
      description: getMeta('meta[property="og:description"]'),
      image:       getMeta('meta[property="og:image"]'),
      type:        getMeta('meta[property="og:type"]'),
    };
    const twitter: TwitterData = {
      title: getMeta('meta[name="twitter:title"]'),
      card:  getMeta('meta[name="twitter:card"]'),
    };

    const schema: SchemaEntry[] = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    ).map(s => {
      try {
        const parsed = JSON.parse(s.textContent || '{}');
        return { type: parsed['@type'] || 'Unknown', raw: (s.textContent || '').slice(0, 500) };
      } catch { return null; }
    }).filter(Boolean) as SchemaEntry[];

    let hostname = '';
    try { hostname = new URL(baseUrl).hostname; } catch {}

    const allLinks = Array.from(document.querySelectorAll('a[href]'));
    let internalLinkCount = 0, externalLinkCount = 0;
    for (const a of allLinks) {
      const href = (a as HTMLAnchorElement).href;
      if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
      try {
        if (new URL(href).hostname === hostname) internalLinkCount++;
        else externalLinkCount++;
      } catch {}
    }

    const images = Array.from(document.querySelectorAll('img'));
    const imagesWithoutAlt = images.filter(img =>
      !img.hasAttribute('alt') || img.alt.trim() === '',
    ).length;

    const isIndexable = !robots.toLowerCase().includes('noindex');
    let canonicalIsSelf = false;
    if (canonical) {
      try { canonicalIsSelf = normalizeUrl(canonical) === normalizeUrl(baseUrl); } catch {}
    }

    return {
      title, description, keywords, robots, viewport, canonical, canonicalIsSelf,
      lang, charset, headings, og, twitter, schema, isIndexable,
      internalLinkCount, externalLinkCount,
      imageCount: images.length, imagesWithoutAlt,
    };

    function normalizeUrl(raw: string): string {
      try {
        const u = new URL(raw); u.hash = '';
        let p = u.pathname; if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
        u.pathname = p; return u.href;
      } catch { return raw; }
    }
  }, opts.pageUrl);

  // ─── Sitemap check (homepage only) ───────────────────────────────────────────
  let sitemapFound = false;
  let sitemapUrl = opts.sitemapUrl || '';
  let sitemapPageCount = 0;

  if (opts.isHomepage) {
    if (sitemapUrl) {
      sitemapFound = true;
      try { sitemapPageCount = (await fetchSitemapUrls(sitemapUrl, 500)).length; } catch {}
    } else {
      const origin = new URL(opts.pageUrl).origin;
      for (const candidate of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap.php']) {
        try {
          const res = await fetch(`${origin}${candidate}`, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
          if (res.ok) { sitemapFound = true; sitemapUrl = `${origin}${candidate}`; break; }
        } catch {}
      }
    }
  }

  // ─── Build issues ─────────────────────────────────────────────────────────────
  const issues: AuditIssue[] = [];
  const h1Count = data.headings.filter(h => h.level === 1).length;

  const add = (
    id: string,
    severity: AuditIssue['severity'],
    title: string,
    description: string,
    extras: Partial<AuditIssue> = {},
  ) => issues.push({ id, severity, category: 'seo', title, description, ...extras });

  if (!data.title) {
    add('seo-missing-title', 'critical', 'Missing title tag', 'The page has no <title> tag. Title is critical for SEO and is shown in search results.');
  } else if (data.title.length < 30) {
    add('seo-title-too-short', 'warning', 'Title tag too short', `Title is ${data.title.length} characters. Aim for 30–60 characters.`, { value: `${data.title.length} chars` });
  } else if (data.title.length > 60) {
    add('seo-title-too-long', 'warning', 'Title tag too long', `Title is ${data.title.length} characters. Keep it under 60 to avoid truncation in SERPs.`, { value: `${data.title.length} chars` });
  }

  if (!data.description) {
    add('seo-missing-description', 'warning', 'Missing meta description', 'No meta description found. Descriptions are shown in search results and impact click-through rate.');
  } else if (data.description.length < 120) {
    add('seo-description-short', 'info', 'Meta description too short', `Description is ${data.description.length} characters. Aim for 120–160 characters.`, { value: `${data.description.length} chars` });
  } else if (data.description.length > 160) {
    add('seo-description-long', 'info', 'Meta description too long', `Description is ${data.description.length} characters. May be truncated in SERPs above 160 characters.`, { value: `${data.description.length} chars` });
  }

  if (h1Count === 0) {
    add('seo-missing-h1', 'critical', 'Missing H1 heading', 'No H1 heading found on this page. Every page should have exactly one H1 defining its main topic.');
  } else if (h1Count > 1) {
    add('seo-multiple-h1', 'warning', 'Multiple H1 headings', `Found ${h1Count} H1 headings. Best practice is exactly one H1 per page.`, { value: `${h1Count} H1s` });
  }

  if (!data.viewport) {
    add('seo-missing-viewport', 'warning', 'Missing viewport meta tag', 'No viewport meta tag. Without it, mobile browsers render the page at desktop width.');
  }

  if (!data.lang) {
    add('seo-missing-lang', 'info', 'Missing HTML lang attribute', 'The <html> element has no lang attribute. This affects accessibility and language-specific search ranking.');
  }

  if (!data.canonical) {
    add('seo-missing-canonical', 'info', 'Missing canonical link', 'No canonical URL specified. Add <link rel="canonical"> to prevent duplicate content issues.');
  }

  if (!data.isIndexable) {
    add('seo-noindex', 'warning', 'Page is set to noindex', `robots meta is "${data.robots}". Search engines will not index this page.`, { value: data.robots });
  }

  if (data.imagesWithoutAlt > 0) {
    add('seo-images-missing-alt', 'warning', 'Images missing alt text',
      `${data.imagesWithoutAlt} of ${data.imageCount} images have no alt attribute. Alt text is required for accessibility and image search.`,
      { value: `${data.imagesWithoutAlt} images` });
  }

  if (!data.og.title && !data.og.description) {
    add('seo-missing-og-tags', 'info', 'Missing Open Graph tags', 'No og:title or og:description meta tags. These control how your page appears when shared on social media.');
  }

  if (opts.isHomepage && !sitemapFound && opts.robotsTxtFound) {
    add('seo-missing-sitemap', 'warning', 'No sitemap.xml detected', 'Could not find a sitemap at /sitemap.xml or /sitemap_index.xml. A sitemap helps search engines discover all your pages.');
  }

  return {
    title: data.title,
    titleLength: data.title.length,
    description: data.description,
    descriptionLength: data.description.length,
    keywords: data.keywords,
    headings: data.headings,
    h1Count,
    canonical: data.canonical,
    canonicalIsSelf: data.canonicalIsSelf,
    isIndexable: data.isIndexable,
    robots: data.robots,
    openGraph: data.og,
    twitter: data.twitter,
    schema: data.schema,
    viewport: data.viewport,
    lang: data.lang,
    charset: data.charset,
    internalLinkCount: data.internalLinkCount,
    externalLinkCount: data.externalLinkCount,
    imageCount: data.imageCount,
    imagesWithoutAlt: data.imagesWithoutAlt,
    sitemapFound,
    sitemapUrl,
    sitemapPageCount,
    robotsTxtFound: opts.robotsTxtFound ?? false,
    robotsTxtDisallowed: opts.robotsTxtDisallowed ?? [],
    issues,
  };
}
