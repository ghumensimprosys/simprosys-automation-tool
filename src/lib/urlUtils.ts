/**
 * src/lib/urlUtils.ts
 *
 * URL normalisation and classification helpers used by the crawl engine,
 * robots.txt parser, and link auditor. No external dependencies — built-in
 * URL class only.
 */

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * Normalise a URL string:
 * - Ensures http:// or https:// scheme (defaults to https)
 * - Strips fragments (#hash)
 * - Lowercases scheme and host
 * - Removes default ports (80 for http, 443 for https)
 * - Removes trailing slash from non-root paths
 *
 * Returns null if the input is not a valid http/https URL.
 */
export function normalizeUrl(raw: string): string | null {
  let str = raw.trim();
  if (!str) return null;
  if (!str.startsWith('http://') && !str.startsWith('https://')) {
    str = `https://${str}`;
  }
  try {
    const u = new URL(str);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

    // Strip fragment
    u.hash = '';

    // Remove default ports
    if ((u.protocol === 'http:' && u.port === '80') ||
        (u.protocol === 'https:' && u.port === '443')) {
      u.port = '';
    }

    // Remove trailing slash from non-root paths
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    u.pathname = pathname;

    return u.href;
  } catch {
    return null;
  }
}

/**
 * Resolve a potentially relative URL against a base page URL.
 * Returns a normalised absolute URL, or null if resolution fails or
 * the result is not an http/https URL.
 */
export function resolveUrl(href: string, baseUrl: string): string | null {
  if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return null;
  }
  try {
    const absolute = new URL(href, baseUrl).href;
    return normalizeUrl(absolute);
  } catch {
    return null;
  }
}

// ─── Origin / same-origin checks ─────────────────────────────────────────────

/** Extract scheme+host+port origin string, e.g. 'https://example.com'. Returns '' on failure. */
export function getOrigin(url: string): string {
  try { return new URL(url).origin; } catch { return ''; }
}

/** True if `url` has the same scheme+host+port as `baseUrl`. */
export function isSameOrigin(url: string, baseUrl: string): boolean {
  const a = getOrigin(url);
  const b = getOrigin(baseUrl);
  return !!a && !!b && a === b;
}

/** Extract the hostname (no port), e.g. 'example.com'. Returns '' on failure. */
export function getHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

/** Extract scheme+hostname, lowercased, e.g. 'https://example.com'. Returns '' on failure. */
export function getDomain(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}`;
  } catch { return ''; }
}

// ─── URL classification ───────────────────────────────────────────────────────

/** True if the URL points to a static asset (image, font, video, etc.) */
export function isStaticAsset(url: string): boolean {
  const STATIC_EXT = /\.(png|jpg|jpeg|gif|svg|webp|ico|bmp|avif|mp4|mp3|webm|woff|woff2|ttf|eot|otf|pdf|zip|gz|tar|dmg|exe|apk)(\?.*)?$/i;
  try {
    return STATIC_EXT.test(new URL(url).pathname);
  } catch { return false; }
}

/** True if the URL is a likely HTML page (not a static asset or API endpoint). */
export function isLikelyPage(url: string): boolean {
  if (isStaticAsset(url)) return false;
  const PAGE_EXT = /\.(html?|php|asp|aspx|jsp|cfm|cgi|pl)(\?.*)?$/i;
  try {
    const u = new URL(url);
    // Path with no extension, or an explicit page extension
    return u.pathname === '/' || !u.pathname.includes('.') || PAGE_EXT.test(u.pathname);
  } catch { return false; }
}

/** True if the URL is commonly a sitemap XML location. */
export function isSitemapUrl(url: string): boolean {
  const SITEMAP_PATTERNS = [/sitemap[\w-]*\.xml/i, /sitemap_index\.xml/i];
  return SITEMAP_PATTERNS.some(p => p.test(url));
}

// ─── robots.txt ───────────────────────────────────────────────────────────────

export interface RobotsTxtResult {
  found: boolean;
  content: string;
  disallowedPaths: string[];
  sitemapUrls: string[];
  crawlDelay: number | null;
}

/**
 * Fetch and parse robots.txt for the given site root URL.
 * Respects only the `*` (all user-agents) rules.
 * No external library — pure string parsing.
 */
export async function fetchRobotsTxt(siteUrl: string): Promise<RobotsTxtResult> {
  const base = normalizeUrl(siteUrl);
  if (!base) return { found: false, content: '', disallowedPaths: [], sitemapUrls: [], crawlDelay: null };

  const origin = getOrigin(base);
  const robotsUrl = `${origin}/robots.txt`;

  try {
    const res = await fetch(robotsUrl, {
      headers: { 'User-Agent': 'SimprosysAuditBot/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { found: false, content: '', disallowedPaths: [], sitemapUrls: [], crawlDelay: null };

    const content = await res.text();
    return parseRobotsTxt(content);
  } catch {
    return { found: false, content: '', disallowedPaths: [], sitemapUrls: [], crawlDelay: null };
  }
}

function parseRobotsTxt(content: string): RobotsTxtResult {
  const disallowedPaths: string[] = [];
  const sitemapUrls: string[] = [];
  let crawlDelay: number | null = null;

  let inRelevantBlock = false;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (key === 'user-agent') {
      inRelevantBlock = value === '*';
      continue;
    }
    if (key === 'sitemap') {
      if (value) sitemapUrls.push(value);
      continue;
    }
    if (!inRelevantBlock) continue;

    if (key === 'disallow' && value) disallowedPaths.push(value);
    if (key === 'crawl-delay') {
      const n = parseFloat(value);
      if (!isNaN(n)) crawlDelay = n;
    }
  }

  return {
    found: true,
    content,
    disallowedPaths,
    sitemapUrls,
    crawlDelay,
  };
}

/**
 * Returns true if the given URL path is disallowed by any of the disallowed paths.
 */
export function isDisallowedByRobots(url: string, disallowedPaths: string[]): boolean {
  try {
    const pathname = new URL(url).pathname;
    return disallowedPaths.some(d => pathname.startsWith(d));
  } catch { return false; }
}

// ─── Sitemap parsing ──────────────────────────────────────────────────────────

/**
 * Fetch and extract all page URLs from a sitemap XML (supports both urlset and sitemapindex).
 * Follows one level of sitemap index — does not recurse infinitely.
 */
export async function fetchSitemapUrls(sitemapUrl: string, maxUrls = 500): Promise<string[]> {
  const urls: string[] = [];
  try {
    const res = await fetch(sitemapUrl, {
      headers: { 'User-Agent': 'SimprosysAuditBot/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return urls;
    const xml = await res.text();

    if (xml.includes('<sitemapindex')) {
      // Sitemap index — extract child sitemap URLs and fetch each
      const childMatches = xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi);
      const childUrls = Array.from(childMatches).map(m => m[1]).filter(isSitemapUrl);
      for (const childUrl of childUrls.slice(0, 5)) {
        const childUrls2 = await fetchSitemapUrls(childUrl, maxUrls - urls.length);
        urls.push(...childUrls2);
        if (urls.length >= maxUrls) break;
      }
    } else {
      // Standard urlset
      const locMatches = xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi);
      for (const match of locMatches) {
        const normalized = normalizeUrl(match[1]);
        if (normalized) urls.push(normalized);
        if (urls.length >= maxUrls) break;
      }
    }
  } catch { /* network or parse error — return what we have */ }

  return urls;
}
