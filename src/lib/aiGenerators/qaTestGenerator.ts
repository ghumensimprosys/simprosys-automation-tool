/**
 * src/lib/aiGenerators/qaTestGenerator.ts
 *
 * Generates manual QA test cases (with Gherkin BDD format) from audit findings.
 * Output can be imported into TestRail, Jira, or Zoho Sprints.
 */

import type { QaTestCase, QaTestStep, AuditIssue, PageAuditResult, TestCategory, TestPriority } from '@/types/audit';
import { generate, TEXT_MODEL, extractJson } from '@/lib/ollama';

export interface QaTestInput {
  siteUrl: string;
  pages: Pick<PageAuditResult, 'url' | 'title' | 'seo'>[];
  issues: AuditIssue[];
  hasForms: boolean;
  hasEcommerce: boolean;
}

interface ModelTestCase {
  id: string;
  title: string;
  category: string;
  priority: string;
  targetUrl: string;
  preconditions: string;
  steps: Array<{ stepNumber: number; action: string }>;
  expectedResult: string;
  relatedIssueId?: string;
  gherkin: string;
}

const VALID_CATEGORIES: TestCategory[] = ['navigation', 'form', 'content', 'accessibility', 'performance', 'security', 'visual'];
const VALID_PRIORITIES: TestPriority[] = ['high', 'medium', 'low'];

export async function generateQaTestCases(input: QaTestInput): Promise<QaTestCase[]> {
  const { siteUrl, pages, issues, hasForms, hasEcommerce } = input;

  const criticalIssues = issues.filter(i => i.severity === 'critical' || i.severity === 'warning').slice(0, 10);
  const pageList = pages.slice(0, 5).map(p => `${p.title || 'Untitled'}: ${p.url}`).join('\n');

  const context = [
    `Site: ${siteUrl}`,
    `Pages: ${pages.length} audited`,
    hasForms && 'Has forms',
    hasEcommerce && 'Ecommerce site (cart/checkout)',
  ].filter(Boolean).join(' | ');

  const issueList = criticalIssues.length > 0
    ? criticalIssues.map(i => `[${i.id}] (${i.severity}) ${i.category}: ${i.title}`).join('\n')
    : 'No critical issues found';

  const systemPrompt = `You are a QA engineer writing structured test cases. Be specific, step-by-step, and verifiable.`;

  const prompt = `Generate QA test cases for: ${context}

Top pages:
${pageList}

Issues to test:
${issueList}

Generate 6-10 test cases covering: navigation, critical issue validation, forms${hasForms ? ' (present)' : ''}, accessibility, performance, and cross-browser basics.

Return ONLY a JSON array matching this schema:
[
  {
    "id": "tc-<kebab-slug>",
    "title": "Test case title",
    "category": "navigation | form | content | accessibility | performance | security | visual",
    "priority": "high | medium | low",
    "targetUrl": "<full URL>",
    "preconditions": "What must be true before running this test",
    "steps": [
      { "stepNumber": 1, "action": "Describe the action" }
    ],
    "expectedResult": "What should happen if the site is working correctly",
    "relatedIssueId": "<issue-id or omit>",
    "gherkin": "Given ...\nWhen ...\nThen ..."
  }
]

Steps should be 3-7 specific, numbered actions. Gherkin must use Given/When/Then format.
Return ONLY the JSON array.`;

  try {
    const raw = await generate(prompt, {
      model: TEXT_MODEL,
      systemPrompt,
      temperature: 0.2,
      numPredict: 4096,
    });

    const parsed = extractJson<ModelTestCase[]>(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.slice(0, 12).map((tc, i): QaTestCase => {
      const category = VALID_CATEGORIES.includes(tc.category as TestCategory)
        ? tc.category as TestCategory : 'navigation';
      const priority = VALID_PRIORITIES.includes(tc.priority as TestPriority)
        ? tc.priority as TestPriority : 'medium';

      const steps: QaTestStep[] = (tc.steps || []).map((s, si) => ({
        stepNumber: s.stepNumber || si + 1,
        action: s.action || '',
      }));

      return {
        id: tc.id || `tc-${i + 1}`,
        title: (tc.title || 'Test case').slice(0, 120),
        category,
        priority,
        targetUrl: tc.targetUrl || siteUrl,
        preconditions: tc.preconditions || 'None',
        steps,
        expectedResult: tc.expectedResult || '',
        relatedIssueId: tc.relatedIssueId,
        gherkin: tc.gherkin || '',
      };
    });
  } catch {
    return [];
  }
}
