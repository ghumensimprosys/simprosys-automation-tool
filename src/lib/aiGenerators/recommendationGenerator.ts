/**
 * src/lib/aiGenerators/recommendationGenerator.ts
 *
 * Generates prioritised AI recommendations from aggregated audit issues using
 * qwen2.5-coder:14b. Groups related issues, ranks by impact, and produces
 * actionable business + technical guidance.
 */

import type { AiRecommendation, AuditIssue, TechDetectionResult, AuditCategory } from '@/types/audit';
import { generate, TEXT_MODEL, extractJson } from '@/lib/ollama';

export interface RecommendationInput {
  siteUrl: string;
  issues: AuditIssue[];
  techStack: TechDetectionResult | null;
  totalPages: number;
  avgLoadTimeMs: number;
}

interface ModelRecommendation {
  id: string;
  issueIds: string[];
  severity: string;
  category: string;
  title: string;
  impact: string;
  recommendation: string;
  suggestedFix: string;
  effort: string;
}

const VALID_CATEGORIES: AuditCategory[] = ['seo', 'accessibility', 'performance', 'security', 'uiux', 'content', 'tech', 'functional', 'visual'];
const VALID_EFFORTS = ['quick', 'medium', 'complex'] as const;
const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

export async function generateRecommendations(input: RecommendationInput): Promise<AiRecommendation[]> {
  const { siteUrl, issues, techStack, totalPages, avgLoadTimeMs } = input;

  // Prioritise: critical first, then warning, group by category
  const criticalIssues  = issues.filter(i => i.severity === 'critical').slice(0, 12);
  const warningIssues   = issues.filter(i => i.severity === 'warning').slice(0, 8);
  const topIssues = [...criticalIssues, ...warningIssues];

  if (topIssues.length === 0) return [];

  const issuesSummary = topIssues.map(i =>
    `[${i.id}] (${i.severity.toUpperCase()}, ${i.category}) ${i.title}${i.pages?.length ? ` — affects ${i.pages.length} page(s)` : ''}`,
  ).join('\n');

  const techSummary = techStack
    ? [
        techStack.framework && `Framework: ${techStack.framework}`,
        techStack.cms && `CMS: ${techStack.cms}`,
        techStack.ecommerce && `Ecommerce: ${techStack.ecommerce}`,
        techStack.analytics.length > 0 && `Analytics: ${techStack.analytics.join(', ')}`,
      ].filter(Boolean).join(' | ')
    : 'Unknown';

  const systemPrompt = `You are a senior web performance and SEO consultant. You produce concise, actionable recommendations backed by technical analysis.`;

  const prompt = `Website audit completed for: ${siteUrl}
Pages audited: ${totalPages} | Avg load time: ${(avgLoadTimeMs / 1000).toFixed(1)}s | Tech: ${techSummary}

ISSUES FOUND (id, severity, category, title):
${issuesSummary}

Generate 5-8 prioritised recommendations. Group related issues into single recommendations where appropriate.

Return ONLY a JSON array (no markdown) matching this schema exactly:
[
  {
    "id": "rec-<kebab-slug>",
    "issueIds": ["issue-id-1", "issue-id-2"],
    "severity": "critical | high | medium | low",
    "category": "seo | accessibility | performance | security | uiux | content | tech | functional | visual",
    "title": "Short title (under 60 chars)",
    "impact": "Business impact statement — what this costs the business (conversions, rankings, compliance)",
    "recommendation": "What to do and why (2-3 sentences)",
    "suggestedFix": "Concrete technical action (specific code, config, or content change)",
    "effort": "quick | medium | complex"
  }
]

Effort: quick = < 1 hour, medium = half day, complex = multi-day.
Return ONLY the JSON array. No text before or after.`;

  try {
    const raw = await generate(prompt, {
      model: TEXT_MODEL,
      systemPrompt,
      temperature: 0.2,
      numPredict: 3000,
    });

    const parsed = extractJson<ModelRecommendation[]>(raw);
    if (!Array.isArray(parsed)) return [];

    const issuePageMap = new Map<string, string[]>();
    for (const issue of issues) {
      issuePageMap.set(issue.id, issue.pages || []);
    }

    return parsed.slice(0, 10).map((r, i): AiRecommendation => {
      const severity = VALID_SEVERITIES.includes(r.severity as typeof VALID_SEVERITIES[number])
        ? r.severity as typeof VALID_SEVERITIES[number] : 'medium';
      const category = VALID_CATEGORIES.includes(r.category as AuditCategory)
        ? r.category as AuditCategory : 'seo';
      const effort = VALID_EFFORTS.includes(r.effort as typeof VALID_EFFORTS[number])
        ? r.effort as typeof VALID_EFFORTS[number] : 'medium';

      const affectedPages = Array.from(new Set(
        (r.issueIds || []).flatMap(id => issuePageMap.get(id) || []),
      ));

      return {
        id: r.id || `rec-${i + 1}`,
        issueIds: r.issueIds || [],
        severity,
        category,
        title: (r.title || 'Recommendation').slice(0, 100),
        impact: r.impact || '',
        recommendation: r.recommendation || '',
        suggestedFix: r.suggestedFix || '',
        effort,
        affectedPages,
      };
    });
  } catch {
    return [];
  }
}
