/**
 * src/lib/auditors/visualAuditor.ts
 *
 * Visual AI analysis using gemma4 (confirmed vision-capable).
 * Sends desktop + optional mobile screenshots to the vision model and
 * requests structured JSON feedback on layout, CTA, navigation, typography,
 * and accessibility.
 */

import type { Browser } from 'playwright';
import type { VisualAnalysisResult, VisualIssue, IssueSeverity, VisualArea } from '@/types/audit';
import { analyzeImages, extractJson, VISION_MODEL } from '@/lib/ollama';
import { createAuditPage, navigateTo, takeScreenshot, VIEWPORTS } from '@/lib/browserManager';

export interface VisualAuditOptions {
  url: string;
  browser: Browser;
  desktopScreenshot: string;
  captureMobile?: boolean;
}

// ─── JSON schema the model should return ─────────────────────────────────────

interface ModelVisualResponse {
  layoutScore: number;
  ctaVisibility: 'prominent' | 'visible' | 'hard_to_find' | 'missing';
  navigationClarity: 'clear' | 'adequate' | 'confusing';
  mobileReadability?: 'good' | 'acceptable' | 'poor';
  issues: Array<{
    id: string;
    severity: string;
    area: string;
    description: string;
  }>;
  positives: string[];
}

const DESKTOP_PROMPT = `You are a professional UX/CRO analyst reviewing a website screenshot. Analyze the FULL screenshot carefully.

Return ONLY valid JSON (no markdown, no explanation) matching this exact schema:
{
  "layoutScore": <integer 0-100, where 90+ = excellent, 70-89 = good, 50-69 = needs work, below 50 = poor>,
  "ctaVisibility": "<one of: prominent | visible | hard_to_find | missing>",
  "navigationClarity": "<one of: clear | adequate | confusing>",
  "issues": [
    {
      "id": "<kebab-case-slug, e.g. visual-cta-below-fold>",
      "severity": "<one of: critical | warning | info>",
      "area": "<one of: layout | cta | navigation | typography | spacing | contrast | trust | mobile>",
      "description": "<specific, actionable description of the issue>"
    }
  ],
  "positives": ["<strength 1>", "<strength 2>"]
}

Rules:
- layoutScore reflects overall visual quality, clarity, and conversion potential
- List 2-6 specific issues. Each must be actionable (e.g. "CTA button has low contrast" not "design could be better")
- List 2-4 genuine positives
- critical = blocking conversion; warning = significant friction; info = improvement opportunity
- Return ONLY the JSON object. Nothing else.`;

const MOBILE_PROMPT = `You are a professional mobile UX analyst reviewing a mobile website screenshot (390px width, iPhone scale).

Return ONLY valid JSON (no markdown) matching this exact schema:
{
  "layoutScore": <integer 0-100>,
  "mobileReadability": "<one of: good | acceptable | poor>",
  "ctaVisibility": "<one of: prominent | visible | hard_to_find | missing>",
  "navigationClarity": "<one of: clear | adequate | confusing>",
  "issues": [
    {
      "id": "<kebab-case-slug>",
      "severity": "<critical | warning | info>",
      "area": "<layout | cta | navigation | typography | spacing | contrast | trust | mobile>",
      "description": "<specific mobile-focused issue>"
    }
  ],
  "positives": ["<mobile strength>"]
}

Focus on: text readability at mobile scale, tap target sizes, CTA prominence, navigation usability, layout reflow.
Return ONLY the JSON object.`;

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runVisualAudit(opts: VisualAuditOptions): Promise<VisualAnalysisResult> {
  const { url, browser, desktopScreenshot, captureMobile = true } = opts;

  // ─── Desktop analysis ─────────────────────────────────────────────────────
  let desktopRaw = '';
  let desktopResponse: ModelVisualResponse | null = null;

  try {
    desktopRaw = await analyzeImages(DESKTOP_PROMPT, [desktopScreenshot], {
      model: VISION_MODEL,
      temperature: 0.1,
      numPredict: 1024,
    });
    desktopResponse = extractJson<ModelVisualResponse>(desktopRaw);
  } catch {
    desktopResponse = null;
  }

  // ─── Mobile screenshot + analysis ────────────────────────────────────────
  let mobileScreenshot: string | null = null;
  let mobileRaw: string | null = null;
  let mobileResponse: ModelVisualResponse | null = null;

  if (captureMobile) {
    try {
      const { page: mobilePage, close } = await createAuditPage(browser, VIEWPORTS.mobile);
      try {
        await navigateTo(mobilePage, url);
        mobileScreenshot = await takeScreenshot(mobilePage, false);
      } finally {
        await close();
      }
    } catch { mobileScreenshot = null; }

    if (mobileScreenshot) {
      try {
        mobileRaw = await analyzeImages(MOBILE_PROMPT, [mobileScreenshot], {
          model: VISION_MODEL,
          temperature: 0.1,
          numPredict: 1024,
        });
        mobileResponse = extractJson<ModelVisualResponse>(mobileRaw);
      } catch {
        mobileResponse = null;
      }
    }
  }

  // ─── Build VisualIssue[] ──────────────────────────────────────────────────
  const visualIssues: VisualIssue[] = [];

  const addIssues = (
    raw: ModelVisualResponse['issues'],
    viewport: 'desktop' | 'mobile',
  ) => {
    for (const i of (raw || [])) {
      const severity = (['critical', 'warning', 'info'].includes(i.severity)
        ? i.severity : 'info') as IssueSeverity;
      const area = (['layout', 'cta', 'navigation', 'typography', 'spacing', 'contrast', 'trust', 'mobile'].includes(i.area)
        ? i.area : 'layout') as VisualArea;
      visualIssues.push({
        id: i.id || `visual-${viewport}-${visualIssues.length}`,
        severity,
        area,
        description: i.description || '',
        viewport,
      });
    }
  };

  if (desktopResponse) addIssues(desktopResponse.issues, 'desktop');
  if (mobileResponse)  addIssues(mobileResponse.issues, 'mobile');

  // ─── Merge positives ──────────────────────────────────────────────────────
  const positives: string[] = [
    ...(desktopResponse?.positives || []),
    ...(mobileResponse?.positives || []).map(p => `[Mobile] ${p}`),
  ];

  // ─── Fallback if model failed ──────────────────────────────────────────────
  if (!desktopResponse) {
    return {
      model: VISION_MODEL,
      desktopLayoutScore: 0,
      mobileLayoutScore: null,
      ctaVisibility: 'missing',
      navigationClarity: 'clear',
      mobileReadability: null,
      visualIssues: [{
        id: 'visual-analysis-failed',
        severity: 'info',
        area: 'layout',
        description: 'Visual AI analysis could not be completed. Ensure gemma4 is available in Ollama.',
        viewport: 'desktop',
      }],
      positives: [],
      desktopAnalysis: desktopRaw || 'No response',
      mobileAnalysis: mobileRaw,
    };
  }

  const validCtaValues = ['prominent', 'visible', 'hard_to_find', 'missing'] as const;
  const ctaVisibility = validCtaValues.includes(desktopResponse.ctaVisibility as typeof validCtaValues[number])
    ? desktopResponse.ctaVisibility
    : 'missing';

  const validNavValues = ['clear', 'adequate', 'confusing'] as const;
  const navigationClarity = validNavValues.includes(desktopResponse.navigationClarity as typeof validNavValues[number])
    ? desktopResponse.navigationClarity
    : 'clear';

  const validMobileReadability = ['good', 'acceptable', 'poor'] as const;
  const mobileReadability = mobileResponse?.mobileReadability &&
    validMobileReadability.includes(mobileResponse.mobileReadability as typeof validMobileReadability[number])
    ? mobileResponse.mobileReadability
    : null;

  return {
    model: VISION_MODEL,
    desktopLayoutScore: Math.max(0, Math.min(100, Math.round(desktopResponse.layoutScore || 0))),
    mobileLayoutScore: mobileResponse
      ? Math.max(0, Math.min(100, Math.round(mobileResponse.layoutScore || 0)))
      : null,
    ctaVisibility,
    navigationClarity,
    mobileReadability,
    visualIssues,
    positives,
    desktopAnalysis: desktopRaw,
    mobileAnalysis: mobileRaw,
  };
}
