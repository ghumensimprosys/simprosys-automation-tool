import { NextResponse } from 'next/server';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import vm from 'node:vm';
import { OLLAMA_BASE_URL, TEXT_MODEL, generate } from '@/lib/ollama';
import { checkForDangerousCode } from '@/lib/codeGuard';

// Single source of truth for timeouts — change here to affect the entire file.
const DEFAULT_TIMEOUT = 20000;
const NAV_TIMEOUT     = 45000;

// ─── Shared executor ─────────────────────────────────────────────────────────
// Runs user-supplied Playwright code inside an isolated V8 context so the
// script cannot access Node.js globals (process, require, __dirname, etc.).
// Playwright objects (page, context, browser) and a restricted expect helper
// are the only server-side values exposed to the sandbox.
async function executeScript(
  cleanCode: string,
  page: any,
  context: any,
  browser: any,
  variables: Record<string, string>,
  executionLogs: { type: string; message: string }[]
) {
  const customConsole = {
    log: (...args: any[]) => {
      executionLogs.push({ type: 'info', message: args.join(' ') });
    },
    error: (...args: any[]) => {
      executionLogs.push({ type: 'error', message: args.join(' ') });
    },
  };

  const expect = (locator: any) => ({
    toBeVisible: async (options?: { timeout?: number }) => {
      await locator.waitFor({ state: 'visible', timeout: options?.timeout ?? DEFAULT_TIMEOUT });
    },
    toHaveText: async (text: string) => {
      const elText = await locator.innerText({ timeout: DEFAULT_TIMEOUT });
      if (!elText.includes(text)) throw new Error(`Expected text "${text}" but found "${elText}"`);
    },
    toContainText: async (text: string) => {
      const elText = await locator.innerText({ timeout: DEFAULT_TIMEOUT });
      if (!elText.includes(text))
        throw new Error(`Expected to contain "${text}" but found "${elText}"`);
    },
    toBeDisabled: async () => {
      const isDisabled = await locator.isDisabled({ timeout: DEFAULT_TIMEOUT });
      if (!isDisabled) throw new Error('Expected element to be disabled');
    },
    toBeChecked: async () => {
      const isChecked = await locator.isChecked({ timeout: DEFAULT_TIMEOUT });
      if (!isChecked) throw new Error('Expected element to be checked');
    },
    toHaveValue: async (val: string) => {
      const actualVal = await locator.inputValue({ timeout: DEFAULT_TIMEOUT });
      if (actualVal !== val) throw new Error(`Expected value "${val}" but found "${actualVal}"`);
    },
  });

  // Isolated V8 context — only the listed identifiers are reachable from
  // user code. Node.js globals (process, require, __dirname, global, etc.)
  // are not included, so they resolve as ReferenceError inside the sandbox.
  const sandbox = vm.createContext({
    // Playwright API
    page,
    context,
    browser,
    // QA helpers
    expect,
    console: customConsole,
    storedVariables: variables,
    // JS built-ins needed by typical Playwright scripts
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Error,
    TypeError,
    RangeError,
    URL,
    URLSearchParams,
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Set,
    Map,
    Symbol,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
  });

  const script = new vm.Script(`(async function() {\n${cleanCode}\n})()`);

  // vm timeout only covers synchronous execution; for async Playwright calls
  // we rely on Playwright's own per-operation timeouts (set via
  // page.setDefaultTimeout / page.setDefaultNavigationTimeout above).
  // An outer 90-second race handles any edge case where neither fires.
  const execution = script.runInContext(sandbox);
  const deadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Script execution timed out after 90 seconds')), 90_000),
  );
  await Promise.race([execution, deadline]);
}

export async function POST(req: Request) {
  // TODO: Before internal deployment, add authentication here.
  // Example: check req.headers.get('x-api-key') === process.env.API_SECRET

  let browser: any = null;
  let executionLogs: { type: string; message: string }[] = [];

  try {
    const {
      url,
      instructions,
      reusableRules = {},
      variables = {},
      directCode,
    } = await req.json();

    if (!url || (!instructions && !directCode)) {
      return NextResponse.json(
        { success: false, error: 'URL and instructions (or directCode) are required' },
        { status: 400 }
      );
    }

    // ─── Validate URL scheme (must be http or https) ─────────────────────────
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid URL' },
        { status: 400 }
      );
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return NextResponse.json(
        { success: false, error: 'Only http:// and https:// URLs are allowed' },
        { status: 400 }
      );
    }
    // Use the normalized form in both page.goto and the LLM prompt to prevent
    // prompt injection via a crafted URL string.
    const safeUrl = parsedUrl.href;

    // ─── directCode safety check (before browser launch) ─────────────────────
    if (directCode) {
      const danger = checkForDangerousCode(directCode);
      if (danger) {
        return NextResponse.json(
          { success: false, error: `Blocked: directCode contains a disallowed pattern (${danger})` },
          { status: 400 }
        );
      }
    }

    // ─── Ollama health check (before browser launch, so we don't leak it) ────
    if (!directCode) {
      try {
        const healthCheck = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
        if (!healthCheck.ok) throw new Error('Ollama health check failed');
      } catch {
        return NextResponse.json(
          {
            success: false,
            error: `Cannot reach Ollama at ${OLLAMA_BASE_URL}. Make sure Ollama is running: run "ollama serve" in a terminal.`,
          },
          { status: 503 }
        );
      }
    }

    // ─── Launch browser ──────────────────────────────────────────────────────
    executionLogs.push({ type: 'info', message: 'Launching Playwright browser...' });
    browser = await chromium.launch({ headless: true });

    // Load saved auth state if available.
    // Primary:  playwright/.auth/user.json  (saved by: npx playwright test --ui)
    // Fallback: shopify-auth.json           (saved by: node save-shopify-auth.js)
    const authPaths = [
      path.join(process.cwd(), 'playwright', '.auth', 'user.json'),
      path.join(process.cwd(), 'shopify-auth.json'),
    ];
    const foundAuthPath = authPaths.find(p => fs.existsSync(p));
    const storageStateOption = foundAuthPath ? { storageState: foundAuthPath } : {};
    if (foundAuthPath) {
      executionLogs.push({ type: 'info', message: 'Loaded saved auth state from ' + path.relative(process.cwd(), foundAuthPath) });
    }

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...storageStateOption,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(DEFAULT_TIMEOUT);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);

    page.on('console', (msg: any) => {
      executionLogs.push({ type: 'info', message: `[Browser] ${msg.text()}` });
    });
    page.on('dialog', async (dialog: any) => {
      executionLogs.push({
        type: 'info',
        message: `[Dialog] Auto-accepted ${dialog.type()} ("${dialog.message()}")`,
      });
      await dialog.accept().catch(() => {});
    });

    executionLogs.push({ type: 'info', message: `Navigating to ${safeUrl}...` });
    try {
      await page.goto(safeUrl, { waitUntil: 'commit', timeout: NAV_TIMEOUT });
      // Give the page a moment to start rendering before element extraction
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1500);
    } catch (navErr: any) {
      executionLogs.push({
        type: 'info',
        message: `[WARN] Initial navigation to ${safeUrl} did not complete (${navErr.message?.split('\n')[0]}). Test steps will handle their own navigation.`,
      });
    }

    // ─── Extract interactive elements ────────────────────────────────────────
    executionLogs.push({ type: 'info', message: 'Extracting page interactive elements...' });
    const interactiveElements = await page.evaluate(() => {
      const selectables = Array.from(
        document.querySelectorAll(
          'a, button, input, textarea, select, [role="button"], [data-testid], [data-test]'
        )
      );
      return selectables
        .filter((el) => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
          );
        })
        .map((el) => {
          const htmlEl = el as HTMLElement;
          return {
            tag: htmlEl.tagName.toLowerCase(),
            text: (htmlEl.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 50),
            id: htmlEl.id || undefined,
            name: htmlEl.getAttribute('name') || undefined,
            type: htmlEl.getAttribute('type') || undefined,
            placeholder: htmlEl.getAttribute('placeholder') || undefined,
            ariaLabel: htmlEl.getAttribute('aria-label') || undefined,
            testId:
              htmlEl.getAttribute('data-testid') || htmlEl.getAttribute('data-test') || undefined,
          };
        })
        .slice(0, 50);
    });

    let cleanCode: string;

    // ─── DIRECT CODE MODE: skip AI entirely ──────────────────────────────────
    if (directCode) {
      executionLogs.push({
        type: 'info',
        message: '⚡ Direct Playwright code mode — skipping AI translation.',
      });
      cleanCode = directCode.trim();
    } else {
      // ─── LOCAL AI TRANSLATION MODE (Ollama) ───────────────────────────────
      // Expand reusable rules recursively
      const expandRules = (text: string, rules: Record<string, string>, depth = 0): string => {
        if (depth > 5) return text;
        const lines = text.split('\n');
        const expandedLines: string[] = [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && rules[trimmed] !== undefined) {
            expandedLines.push(expandRules(rules[trimmed], rules, depth + 1));
          } else {
            expandedLines.push(line);
          }
        }
        return expandedLines.join('\n');
      };

      const expandedInstructions = expandRules(instructions, reusableRules);
      executionLogs.push({
        type: 'info',
        message: `Found ${interactiveElements.length} interactive elements. Generating automation script via local model (${TEXT_MODEL})...`,
      });

      const systemPrompt =
        'You output only raw valid JavaScript code. No markdown. No code fences. No explanations. Never use timeout values below 20000. Output ONLY the code that goes inside an async function body.';

      const prompt = `You are an expert QA automation engineer. Convert the following plain English Simprosys Testing Tool instructions into Playwright automation steps in JavaScript.
The target URL is: ${safeUrl}

Here is a list of the interactive HTML elements currently visible on the target page:
${JSON.stringify(interactiveElements, null, 2)}

Instructions:
${expandedInstructions}

Global Variables (access or set values in the \`storedVariables\` object, e.g. \`storedVariables['varName']\`):
${JSON.stringify(variables, null, 2)}

Write ONLY the JavaScript code that would go inside an async function body.
Do NOT include markdown formatting, \`\`\`javascript tags, wrapper IIFE, imports, or exports. Just the raw, valid JavaScript code.

CRITICAL RULES:
1. NEVER use timeout values below 20000. All timeout options MUST be { timeout: 20000 } or higher.
2. Do NOT invent element IDs or classes not in the elements list. Use text-based locators like page.locator('text=X').first() when unsure.
3. After any click causing navigation (checkout, submit), add: await page.waitForLoadState('domcontentloaded', { timeout: 45000 }); await page.waitForTimeout(2000);
4. Use wildcard matching for inputs: page.locator('input[placeholder*="Field"], input[name*="field"]').first()
5. Include console.log statements for each step (captured as execution logs).
6. HIDDEN ELEMENTS: Never use waitFor({ state: 'visible' }) on buttons that might be CSS-hidden (e.g. Shopify cart/checkout buttons). Instead use:
   await btn.scrollIntoViewIfNeeded({ timeout: 20000 }).catch(() => {});
   const isVis = await btn.isVisible().catch(() => false);
   if (isVis) { await btn.click(); } else { await btn.click({ force: true }); }
7. SHOPIFY CART: The checkout button [name="checkout"] is often hidden by the cart drawer CSS. Always use the force-click pattern from Rule 6 for it.

GUIDELINES:
1. CLICKS: "click 'X'" -> await page.locator('text=X').first().click();
2. INPUTS: "enter 'V' into 'F'" -> await page.locator('input[placeholder*="F"], input[name*="F"]').first().fill("V");
3. ASSERTIONS: "check that page contains 'T'" -> await expect(page.locator('text=T').first()).toBeVisible({ timeout: 20000 });
4. NAVIGATION: "open url 'U'" -> await page.goto("U", { waitUntil: 'domcontentloaded', timeout: 45000 }); await page.waitForTimeout(2000);
5. KEYS: "enter enter" -> await page.keyboard.press('Enter');
6. SCROLL: "scroll down" -> await page.evaluate(() => window.scrollBy(0, window.innerHeight));
7. VARIABLES: "grab value from 'E' and save as 'v'" -> storedVariables['v'] = await page.locator('text=E').first().innerText();
8. SHOPIFY CHECKOUT inputs: use '#email, input[placeholder*="Email"]', '#firstName', '#lastName', '#address1', '#city', '#zip' style selectors.
9. BOGUS GATEWAY: card field: input[name="number"], expiry: input[name="month"], cvv: input[name="verification_value"]`;

      executionLogs.push({
        type: 'info',
        message: `Sending prompt to local model: ${TEXT_MODEL} ...`,
      });

      const rawCode = await generate(prompt, { model: TEXT_MODEL, systemPrompt });

      // Sanitize: strip markdown fences + replace timeouts below 20000
      // Matches 1-4 digit values (0–9999) and 5-digit values in the 10000–19999 range.
      cleanCode = rawCode
        .replace(/^```(?:javascript|js|typescript|ts)?\n?/gm, '')
        .replace(/^```\s*$/gm, '')
        .replace(/\btimeout:\s*(?:1[0-9]{4}|[0-9]{1,4})\b/g, `timeout: ${DEFAULT_TIMEOUT}`)
        .trim();

      // Reject AI output that contains dangerous Node.js patterns
      const danger = checkForDangerousCode(cleanCode);
      if (danger) {
        return NextResponse.json(
          {
            success: false,
            error: `AI generated a disallowed code pattern (${danger}). Refusing to execute.`,
            logs: executionLogs,
          },
          { status: 500 }
        );
      }
    }

    executionLogs.push({ type: 'info', message: 'Generated Script:' });
    executionLogs.push({ type: 'info', message: cleanCode });

    // ─── Execute the script ──────────────────────────────────────────────────
    let executionSuccess = true;
    let errorMessage = '';

    try {
      executionLogs.push({ type: 'info', message: 'Executing script steps...' });
      await executeScript(cleanCode, page, context, browser, variables, executionLogs);
      executionLogs.push({ type: 'success', message: 'All test steps completed successfully.' });
    } catch (e: any) {
      executionSuccess = false;
      errorMessage = e.message;
      executionLogs.push({ type: 'error', message: `Execution Error: ${e.message}` });
    }

    // ─── Screenshot ───────────────────────────────────────────────────────────
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    const screenshotBase64 = screenshotBuffer.toString('base64');

    await browser.close();

    return NextResponse.json({
      success: executionSuccess,
      logs: executionLogs,
      code: cleanCode,
      screenshot: screenshotBase64,
      error: errorMessage || undefined,
      variables,
      interactiveElements,
    });
  } catch (error: any) {
    if (browser) {
      await browser.close();
    }
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error.message, logs: executionLogs },
      { status: 500 }
    );
  }
}
