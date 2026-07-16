/**
 * src/lib/aiGenerators/playwrightGenerator.ts
 *
 * Generates a runnable Playwright JavaScript test suite from QA test cases
 * and audit findings. Output is compatible with the Standard Automation editor.
 *
 * Uses qwen2.5-coder:14b (same model as run-test/route.ts).
 */

import type { PlaywrightTestSuite, QaTestCase, AuditIssue, CrawlMode } from '@/types/audit';
import { generate, TEXT_MODEL } from '@/lib/ollama';

export interface PlaywrightGenInput {
  siteUrl: string;
  crawlMode: CrawlMode;
  qaTestCases: QaTestCase[];
  criticalIssues: AuditIssue[];
  hasForms: boolean;
  hasEcommerce: boolean;
}

export async function generatePlaywrightSuite(input: PlaywrightGenInput): Promise<PlaywrightTestSuite | null> {
  const { siteUrl, crawlMode, qaTestCases, criticalIssues, hasForms, hasEcommerce } = input;

  const testCaseSummary = qaTestCases.slice(0, 8).map(tc =>
    `// Test: ${tc.title}\n// Steps: ${tc.steps.map(s => s.action).join(' → ')}`,
  ).join('\n\n');

  const issueSummary = criticalIssues.slice(0, 5).map(i =>
    `// ${i.category}: ${i.title}`,
  ).join('\n');

  const systemPrompt = `You are an expert Playwright automation engineer. You write clean, robust, production-ready JavaScript Playwright tests. All code must be valid JavaScript (not TypeScript). Use async/await. Never use require(). Use only Playwright API methods.`;

  const prompt = `Generate a Playwright JavaScript test file for: ${siteUrl}

Context:
- Crawl mode: ${crawlMode}
- Forms present: ${hasForms}
- Ecommerce: ${hasEcommerce}

QA test cases to automate:
${testCaseSummary || '// Basic navigation and content checks'}

Issues to verify are fixed:
${issueSummary || '// No critical issues'}

Requirements:
1. Write a complete, runnable Playwright test file
2. Use page.goto(), page.locator(), page.waitForLoadState() etc
3. Include proper expect() assertions
4. Add comments explaining each test
5. Use const { chromium } = require('playwright'); at the top
6. Wrap all tests in an async main() function and call it
7. Each test should navigate to the page and verify a specific condition
8. Add await page.waitForLoadState('domcontentloaded') after navigation
9. Use 20000ms timeouts
10. Include at least: navigation test, page title check, and one content assertion

Generate a complete, runnable test file (not TypeScript, pure JavaScript).
Do NOT wrap in markdown code fences. Return ONLY the JavaScript code.`;

  try {
    const script = await generate(prompt, {
      model: TEXT_MODEL,
      systemPrompt,
      temperature: 0.1,
      numPredict: 4096,
    });

    // Strip any markdown fences that slipped through
    const cleanScript = script
      .replace(/^```(?:javascript|js)?\n?/gm, '')
      .replace(/^```\s*$/gm, '')
      .trim();

    if (!cleanScript || cleanScript.length < 100) return null;

    // Count tests roughly by looking for async function definitions
    const testCount = (cleanScript.match(/async\s+function\s+test/g) || []).length || 1;

    const coverageAreas: string[] = [];
    if (cleanScript.includes('goto')) coverageAreas.push('navigation');
    if (cleanScript.includes('fill') || cleanScript.includes('type')) coverageAreas.push('form interaction');
    if (cleanScript.includes('locator') || cleanScript.includes('text=')) coverageAreas.push('content verification');
    if (cleanScript.includes('screenshot')) coverageAreas.push('visual');
    if (cleanScript.includes('waitFor')) coverageAreas.push('timing/async');

    return {
      generatedAt: Date.now(),
      targetUrl: siteUrl,
      crawlMode,
      script: cleanScript,
      testCount,
      coverageAreas,
    };
  } catch {
    return null;
  }
}
