import type { Page } from 'playwright';
import type {
  SecurityResult, SecurityHeaderStatus, MixedContentItem, CookieIssue, AuditIssue,
} from '@/types/audit';

export interface SecurityAuditOptions {
  url: string;
  responseHeaders: Record<string, string>;
}

// Headers to check, grouped by requirement tier.
const REQUIRED_HEADERS: { header: string; tier: SecurityHeaderStatus['tier'] }[] = [
  { header: 'strict-transport-security', tier: 'required' },
  { header: 'x-content-type-options',    tier: 'required' },
  { header: 'x-frame-options',           tier: 'required' },
  { header: 'content-security-policy',   tier: 'recommended' },
  { header: 'referrer-policy',           tier: 'recommended' },
  { header: 'permissions-policy',        tier: 'recommended' },
  { header: 'cross-origin-opener-policy', tier: 'recommended' },
];
const DEPRECATED_HEADERS = ['x-xss-protection', 'x-powered-by', 'server'];

export async function runSecurityAudit(page: Page, opts: SecurityAuditOptions): Promise<SecurityResult> {
  const { url, responseHeaders } = opts;
  const isHttps = url.startsWith('https://');

  // ─── Security headers ─────────────────────────────────────────────────────
  const headers: SecurityHeaderStatus[] = REQUIRED_HEADERS.map(({ header, tier }) => ({
    header,
    tier,
    present: header in responseHeaders,
    value: responseHeaders[header] || null,
  }));
  for (const h of DEPRECATED_HEADERS) {
    if (h in responseHeaders) {
      headers.push({ header: h, tier: 'deprecated', present: true, value: responseHeaders[h] });
    }
  }

  // ─── Mixed content ────────────────────────────────────────────────────────
  const mixedContent: MixedContentItem[] = isHttps
    ? await page.evaluate((): MixedContentItem[] => {
        const items: MixedContentItem[] = [];
        const isHttp = (src: string) => src.startsWith('http://');

        document.querySelectorAll<HTMLImageElement>('img[src]').forEach(el => {
          if (isHttp(el.src)) items.push({ url: el.src, type: 'image', element: el.outerHTML.slice(0, 150) });
        });
        document.querySelectorAll<HTMLScriptElement>('script[src]').forEach(el => {
          if (isHttp(el.src)) items.push({ url: el.src, type: 'script', element: el.outerHTML.slice(0, 150) });
        });
        document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]').forEach(el => {
          if (isHttp(el.href)) items.push({ url: el.href, type: 'stylesheet', element: el.outerHTML.slice(0, 150) });
        });
        document.querySelectorAll<HTMLIFrameElement>('iframe[src]').forEach(el => {
          if (isHttp(el.src)) items.push({ url: el.src, type: 'iframe', element: el.outerHTML.slice(0, 150) });
        });
        return items;
      })
    : [];

  // ─── Cookie issues ────────────────────────────────────────────────────────
  const cookies = await page.context().cookies();
  const cookieIssues: CookieIssue[] = cookies
    .filter(c => c.name && (
      !c.httpOnly || !c.secure || !c.sameSite || c.sameSite === 'None'
    ))
    .map(c => ({
      name: c.name,
      missingHttpOnly: !c.httpOnly,
      missingSecure: !c.secure,
      missingSameSite: !c.sameSite || c.sameSite === 'None',
    }))
    .slice(0, 20);

  // ─── Build issues ──────────────────────────────────────────────────────────
  const issues: AuditIssue[] = [];
  const add = (
    id: string, severity: AuditIssue['severity'],
    title: string, description: string, extras: Partial<AuditIssue> = {},
  ) => issues.push({ id, severity, category: 'security', title, description, ...extras });

  if (!isHttps) {
    add('sec-no-https', 'critical', 'Site not served over HTTPS',
      'The page is served over HTTP. All web traffic should use HTTPS for encryption and integrity.');
  }

  const hsts = responseHeaders['strict-transport-security'];
  if (isHttps && !hsts) {
    add('sec-missing-hsts', 'critical', 'Missing Strict-Transport-Security header',
      'HSTS is missing. Without it, browsers may connect over HTTP first, making the connection vulnerable to downgrade attacks.');
  }

  if (!responseHeaders['x-content-type-options']) {
    add('sec-missing-xcto', 'warning', 'Missing X-Content-Type-Options header',
      'Add X-Content-Type-Options: nosniff to prevent MIME-type sniffing attacks.');
  }

  if (!responseHeaders['x-frame-options'] && !responseHeaders['content-security-policy']?.includes('frame-ancestors')) {
    add('sec-missing-xfo', 'warning', 'Missing clickjacking protection',
      'No X-Frame-Options or CSP frame-ancestors directive. The site may be vulnerable to clickjacking.');
  }

  if (!responseHeaders['content-security-policy']) {
    add('sec-missing-csp', 'info', 'No Content-Security-Policy header',
      'A CSP header helps mitigate XSS attacks by controlling which resources can load.');
  }

  if (!responseHeaders['referrer-policy']) {
    add('sec-missing-referrer', 'info', 'Missing Referrer-Policy header',
      'Without Referrer-Policy, the browser may leak the full URL in the Referer header to third parties.');
  }

  if (responseHeaders['x-powered-by']) {
    add('sec-info-disclosure-xpb', 'info', 'Server technology disclosed via X-Powered-By',
      `X-Powered-By: ${responseHeaders['x-powered-by']} reveals your server stack. Remove to reduce attack surface.`,
      { value: responseHeaders['x-powered-by'] });
  }

  if (mixedContent.length > 0) {
    add('sec-mixed-content', 'critical', 'Mixed content detected',
      `${mixedContent.length} resource(s) load over HTTP on an HTTPS page. Browsers block or warn about mixed content.`,
      { value: `${mixedContent.length} resources` });
  }

  const insecureCookies = cookieIssues.filter(c => c.missingSecure || c.missingHttpOnly);
  if (insecureCookies.length > 0) {
    add('sec-insecure-cookies', 'warning', 'Cookies missing security attributes',
      `${insecureCookies.length} cookie(s) are missing Secure, HttpOnly, or SameSite flags.`,
      { value: `${insecureCookies.length} cookies` });
  }

  return {
    isHttps,
    sslValid: isHttps,
    sslExpiry: null,
    sslDaysRemaining: null,
    headers,
    mixedContent,
    cookieIssues,
    issues,
  };
}
