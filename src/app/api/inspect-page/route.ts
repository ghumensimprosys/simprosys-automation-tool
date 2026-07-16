import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";

const NAV_TIMEOUT = 30000;

export async function POST(req: NextRequest) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawUrl = (body.url || "").trim();
  if (!rawUrl) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const safeUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;

  let browser;
  const startTime = Date.now();

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text().slice(0, 200));
      }
    });

    try {
      await page.goto(safeUrl, { waitUntil: "commit", timeout: NAV_TIMEOUT });
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);
    } catch {
      await page.waitForTimeout(1000);
    }

    const loadTime = Date.now() - startTime;

    const pageData = await page.evaluate((pageUrl: string) => {
      const getMeta = (selectors: string[]) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) return el.getAttribute("content") || "";
        }
        return "";
      };

      const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
        .slice(0, 60)
        .map((h) => ({
          level: parseInt(h.tagName[1]),
          text: (h.textContent || "").trim().slice(0, 120),
        }))
        .filter((h) => h.text.length > 0);

      let hostname = "";
      try { hostname = new URL(pageUrl).hostname; } catch {}

      const links = Array.from(document.querySelectorAll("a[href]"))
        .slice(0, 100)
        .map((a) => {
          const href = (a as HTMLAnchorElement).href;
          let isExternal = false;
          try { isExternal = new URL(href).hostname !== hostname; } catch {}
          return {
            href,
            text: (a.textContent || "").trim().slice(0, 80),
            isExternal,
          };
        })
        .filter((l) => l.href && !l.href.startsWith("javascript:") && !l.href.startsWith("mailto:"));

      const images = Array.from(document.querySelectorAll("img"))
        .slice(0, 50)
        .map((img) => ({
          src: img.src,
          alt: img.alt || "",
          hasAlt: img.hasAttribute("alt") && img.alt.trim() !== "",
        }));

      const forms = Array.from(document.querySelectorAll("form")).map((form) => ({
        action: (form as HTMLFormElement).action || "",
        method: ((form as HTMLFormElement).method || "get").toUpperCase(),
        fields: Array.from(
          form.querySelectorAll("input:not([type='hidden']),select,textarea,button[type='submit']")
        )
          .slice(0, 12)
          .map((f) => {
            const el = f as HTMLInputElement;
            return {
              type: el.type || f.tagName.toLowerCase(),
              name: el.name || "",
              placeholder: el.placeholder || "",
              label: el.getAttribute("aria-label") || "",
            };
          }),
      }));

      return {
        title: document.title,
        description: getMeta(['meta[name="description"]', 'meta[property="og:description"]']),
        keywords: getMeta(['meta[name="keywords"]']),
        ogTitle: getMeta(['meta[property="og:title"]']),
        ogDescription: getMeta(['meta[property="og:description"]']),
        ogImage: getMeta(['meta[property="og:image"]']),
        twitterTitle: getMeta(['meta[name="twitter:title"]']),
        robots: getMeta(['meta[name="robots"]']),
        canonical: ((document.querySelector('link[rel="canonical"]') as HTMLLinkElement)?.href) || "",
        viewport: getMeta(['meta[name="viewport"]']),
        charset: document.characterSet || "",
        lang: document.documentElement.lang || "",
        headings,
        links,
        images,
        forms,
      };
    }, safeUrl);

    const screenshotBuffer = await page.screenshot({ fullPage: false });
    const screenshot = screenshotBuffer.toString("base64");

    await browser.close();
    browser = undefined;

    return NextResponse.json({
      success: true,
      url: safeUrl,
      loadTime,
      screenshot,
      consoleErrors,
      h1Count: pageData.headings.filter((h) => h.level === 1).length,
      totalLinks: pageData.links.length,
      externalLinks: pageData.links.filter((l) => l.isExternal).length,
      internalLinks: pageData.links.filter((l) => !l.isExternal).length,
      totalImages: pageData.images.length,
      imagesWithoutAlt: pageData.images.filter((img) => !img.hasAlt).length,
      totalForms: pageData.forms.length,
      ...pageData,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Inspection failed" },
      { status: 500 }
    );
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}
