/**
 * src/lib/aiGenerators/fixGenerator.ts
 *
 * Generates copy-paste code fixes for audit issues.
 * Groups issues by fix type, calls qwen2.5-coder for each group,
 * and returns FixItem[] with before/after code snippets.
 */

import type { FixItem, AuditIssue, TechDetectionResult, FixType, AuditCategory } from '@/types/audit';
import { generate, TEXT_MODEL, extractJson } from '@/lib/ollama';

export interface FixGenInput {
  issues: AuditIssue[];
  techStack: TechDetectionResult | null;
  siteUrl: string;
}

interface ModelFixItem {
  id: string;
  issueId: string;
  title: string;
  category: string;
  severity: string;
  fixType: string;
  language: string;
  codeSnippet: string;
  beforeCode?: string;
  afterCode?: string;
  effort: string;
  applyScope: string;
}

// Group issues that share a fix pattern
const FIX_GROUPS: { id: string; label: string; issueIdPrefixes: string[]; fixType: FixType; language: string }[] = [
  { id: 'html-meta', label: 'HTML meta tag fixes', issueIdPrefixes: ['seo-missing-title', 'seo-missing-description', 'seo-missing-canonical', 'seo-missing-viewport', 'seo-missing-lang', 'seo-missing-og'], fixType: 'html', language: 'html' },
  { id: 'security-headers', label: 'Security header fixes', issueIdPrefixes: ['sec-missing-hsts', 'sec-missing-xcto', 'sec-missing-xfo', 'sec-missing-csp', 'sec-missing-referrer'], fixType: 'server-config', language: 'nginx' },
  { id: 'img-alt', label: 'Image alt text fixes', issueIdPrefixes: ['seo-images-missing-alt', 'a11y-image-alt'], fixType: 'html', language: 'html' },
  { id: 'performance', label: 'Performance optimisations', issueIdPrefixes: ['perf-render-blocking', 'perf-large-js', 'perf-large-page'], fixType: 'html', language: 'html' },
  { id: 'accessibility', label: 'Accessibility fixes', issueIdPrefixes: ['a11y-'], fixType: 'html', language: 'html' },
  { id: 'content', label: 'Content improvements', issueIdPrefixes: ['content-', 'uiux-'], fixType: 'content', language: 'html' },
];

const VALID_FIX_TYPES: FixType[] = ['html', 'css', 'javascript', 'server-config', 'content', 'playwright'];
const VALID_EFFORTS = ['quick', 'medium', 'complex'] as const;
const VALID_SCOPES = ['single_page', 'site_wide'] as const;

export async function generateFixes(input: FixGenInput): Promise<FixItem[]> {
  const { issues, techStack, siteUrl } = input;
  if (issues.length === 0) return [];

  const techInfo = techStack
    ? [techStack.framework, techStack.cms, techStack.ecommerce, techStack.server]
        .filter(Boolean).join(', ') || 'Unknown'
    : 'Unknown';

  const allFixes: FixItem[] = [];

  // Process groups in parallel
  await Promise.all(FIX_GROUPS.map(async group => {
    const groupIssues = issues.filter(issue =>
      group.issueIdPrefixes.some(prefix => issue.id.startsWith(prefix)),
    );
    if (groupIssues.length === 0) return;

    const issueList = groupIssues.slice(0, 6).map(i =>
      `- [${i.id}] ${i.severity.toUpperCase()}: ${i.title}${i.description ? ` — ${i.description.slice(0, 100)}` : ''}`,
    ).join('\n');

    const systemPrompt = `You are a senior web developer providing copy-paste code fixes. Write real, working code. Be precise and minimal — only fix what is broken.`;

    const prompt = `Generate code fixes for these ${group.label} issues on ${siteUrl}:
Tech stack: ${techInfo}

Issues:
${issueList}

Return ONLY a JSON array of fixes. Each fix must have real, working code:
[
  {
    "id": "fix-<kebab-slug>",
    "issueId": "<issue id this fixes>",
    "title": "Short title",
    "category": "seo | accessibility | performance | security | uiux | content | tech | functional | visual",
    "severity": "critical | warning | info",
    "fixType": "html | css | javascript | server-config | content | playwright",
    "language": "html | css | javascript | nginx | apache | json",
    "codeSnippet": "<complete ready-to-apply code>",
    "beforeCode": "<optional: what to replace>",
    "afterCode": "<optional: replacement code>",
    "effort": "quick | medium | complex",
    "applyScope": "site_wide | single_page"
  }
]

Rules:
- codeSnippet must be real, working code (not pseudo-code or placeholders)
- For HTML fixes: include the exact tags/attributes to add
- For server-config: provide nginx.conf or .htaccess snippet
- beforeCode/afterCode pair shows the specific change clearly
- Return ONLY the JSON array. No markdown, no explanation.`;

    try {
      const raw = await generate(prompt, {
        model: TEXT_MODEL,
        systemPrompt,
        temperature: 0.1,
        numPredict: 2048,
      });

      const parsed = extractJson<ModelFixItem[]>(raw);
      if (!Array.isArray(parsed)) return;

      for (const fix of parsed.slice(0, 4)) {
        const fixType = VALID_FIX_TYPES.includes(fix.fixType as FixType)
          ? fix.fixType as FixType : group.fixType;
        const effort = VALID_EFFORTS.includes(fix.effort as typeof VALID_EFFORTS[number])
          ? fix.effort as typeof VALID_EFFORTS[number] : 'quick';
        const applyScope = VALID_SCOPES.includes(fix.applyScope as typeof VALID_SCOPES[number])
          ? fix.applyScope as typeof VALID_SCOPES[number] : 'site_wide';
        const category = fix.category as AuditCategory;

        // Find affected pages from the related issue
        const relatedIssue = issues.find(i => i.id === fix.issueId);

        allFixes.push({
          id: fix.id || `fix-${allFixes.length + 1}`,
          issueId: fix.issueId || '',
          title: (fix.title || 'Fix').slice(0, 100),
          category,
          severity: (['critical', 'warning', 'info'].includes(fix.severity)
            ? fix.severity : 'warning') as FixItem['severity'],
          fixType,
          language: fix.language || group.language,
          codeSnippet: fix.codeSnippet || '',
          beforeCode: fix.beforeCode || null,
          afterCode: fix.afterCode || null,
          affectedPages: relatedIssue?.pages || [],
          effort,
          applyScope,
        });
      }
    } catch { /* skip group on error */ }
  }));

  // Sort: critical first, then by severity
  return allFixes.sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return (order[a.severity] ?? 2) - (order[b.severity] ?? 2);
  });
}
