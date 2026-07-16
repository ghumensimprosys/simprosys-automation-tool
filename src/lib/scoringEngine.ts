/**
 * src/lib/scoringEngine.ts
 *
 * Two-tier scoring engine:
 *   Tier 1 — Per-page score (0–100) from category results
 *   Tier 2 — Site-wide score (0–100) averaging page scores with penalties
 *
 * Weights are designed to match common SEO/audit tool conventions.
 * All weights are normalised so they sum to 100 within each tier.
 */

import type {
  PageAuditResult,
  SiteWideAnalysis,
  CategoryScores,
  SiteHealthScore,
  ScorePenalty,
  Grade,
  AuditIssue,
  IssueSeverity,
} from '@/types/audit';

// ─── Category weights (must sum to 100) ──────────────────────────────────────

const CATEGORY_WEIGHTS: Record<keyof CategoryScores, number> = {
  seo:           25,
  accessibility: 20,
  performance:   20,
  security:      15,
  uiux:          10,
  functional:    5,
  content:       5,
};

// ─── Issue deductions per severity ───────────────────────────────────────────

const ISSUE_DEDUCTIONS: Record<IssueSeverity, number> = {
  critical: 15,
  warning:  5,
  info:     1,
};

// ─── Per-page score ───────────────────────────────────────────────────────────

/**
 * Compute a per-page score (0–100) from a page's audit results.
 * Each category that ran contributes proportionally to its weight.
 * Categories that did not run (null) are excluded from the denominator.
 */
export function computePageScore(page: PageAuditResult): number {
  let weightedSum = 0;
  let totalWeight = 0;

  const addCategory = (key: keyof CategoryScores, issues: AuditIssue[] | undefined | null) => {
    if (issues === undefined || issues === null) return;
    const deduction = issues.reduce((sum, issue) => sum + ISSUE_DEDUCTIONS[issue.severity], 0);
    const score = Math.max(0, 100 - deduction);
    const weight = CATEGORY_WEIGHTS[key];
    weightedSum += score * weight;
    totalWeight += weight;
  };

  addCategory('seo',           page.seo?.issues);
  addCategory('accessibility', page.accessibility?.issues ?? null);
  addCategory('performance',   page.performance?.issues ?? null);
  addCategory('security',      page.security?.issues ?? null);
  addCategory('uiux',          page.uiux?.issues ?? null);
  addCategory('functional',    page.functional?.issues ?? null);
  addCategory('content',       page.content?.issues ?? null);

  if (totalWeight === 0) return 50;
  return Math.round(weightedSum / totalWeight);
}

// ─── Category breakdown ───────────────────────────────────────────────────────

/**
 * Compute per-category scores across all pages that ran that category.
 */
export function computeCategoryBreakdown(pages: PageAuditResult[]): CategoryScores {
  const totals: Record<keyof CategoryScores, { sum: number; count: number }> = {
    seo:           { sum: 0, count: 0 },
    accessibility: { sum: 0, count: 0 },
    performance:   { sum: 0, count: 0 },
    security:      { sum: 0, count: 0 },
    uiux:          { sum: 0, count: 0 },
    functional:    { sum: 0, count: 0 },
    content:       { sum: 0, count: 0 },
  };

  const addCategory = (
    key: keyof CategoryScores,
    issues: AuditIssue[] | undefined | null,
  ) => {
    if (!issues) return;
    const deduction = issues.reduce((s, i) => s + ISSUE_DEDUCTIONS[i.severity], 0);
    totals[key].sum += Math.max(0, 100 - deduction);
    totals[key].count++;
  };

  for (const page of pages) {
    addCategory('seo',           page.seo?.issues);
    addCategory('accessibility', page.accessibility?.issues ?? null);
    addCategory('performance',   page.performance?.issues ?? null);
    addCategory('security',      page.security?.issues ?? null);
    addCategory('uiux',          page.uiux?.issues ?? null);
    addCategory('functional',    page.functional?.issues ?? null);
    addCategory('content',       page.content?.issues ?? null);
  }

  const avg = (key: keyof CategoryScores): number => {
    const { sum, count } = totals[key];
    return count === 0 ? 100 : Math.round(sum / count);
  };

  return {
    seo:           avg('seo'),
    accessibility: avg('accessibility'),
    performance:   avg('performance'),
    security:      avg('security'),
    uiux:          avg('uiux'),
    functional:    avg('functional'),
    content:       avg('content'),
  };
}

// ─── Site-wide penalties ──────────────────────────────────────────────────────

interface PenaltyInput {
  siteWide: SiteWideAnalysis;
  pageCount: number;
}

function computePenalties({ siteWide, pageCount }: PenaltyInput): ScorePenalty[] {
  const penalties: ScorePenalty[] = [];

  const addPenalty = (reason: string, count: number, deductionPerItem: number) => {
    if (count > 0) {
      penalties.push({ reason, count, deduction: count * deductionPerItem });
    }
  };

  addPenalty('Broken links',                     siteWide.brokenLinks.length,          3);
  addPenalty('Pages missing title tag',          siteWide.missingTitlePages.length,    2);
  addPenalty('Pages missing meta description',   siteWide.missingDescriptionPages.length, 1);
  addPenalty('Pages missing H1',                 siteWide.missingH1Pages.length,       1);
  addPenalty('Non-indexable pages',              siteWide.nonIndexablePages.length,    2);
  addPenalty('Orphaned pages (no inbound links)', siteWide.orphanPages.length,         1);
  addPenalty('Duplicate page titles',            siteWide.duplicateTitles.length,      2);
  addPenalty('Duplicate meta descriptions',      siteWide.duplicateDescriptions.length, 1);
  addPenalty('Redirect chains (3+ hops)',
    siteWide.redirectChains.filter(r => r.hops >= 3).length, 2);

  return penalties;
}

// ─── Site-wide score ──────────────────────────────────────────────────────────

export function computeSiteHealthScore(
  pages: PageAuditResult[],
  siteWide: SiteWideAnalysis,
): SiteHealthScore {
  if (pages.length === 0) {
    return {
      overall: 0,
      grade: 'F',
      breakdown: { seo: 0, accessibility: 0, performance: 0, security: 0, uiux: 0, functional: 0, content: 0 },
      pageScores: [],
      penalties: [],
    };
  }

  const pageScores = pages.map(p => ({
    url: p.url,
    score: p.pageScore,
    issueCount: {
      critical: p.issues.filter(i => i.severity === 'critical').length,
      warning:  p.issues.filter(i => i.severity === 'warning').length,
      info:     p.issues.filter(i => i.severity === 'info').length,
    },
  }));

  const avgPageScore = Math.round(
    pageScores.reduce((s, p) => s + p.score, 0) / pageScores.length,
  );

  const penalties = computePenalties({ siteWide, pageCount: pages.length });
  const totalPenalty = penalties.reduce((s, p) => s + p.deduction, 0);
  const overall = Math.max(0, Math.min(100, avgPageScore - totalPenalty));

  return {
    overall,
    grade: scoreToGrade(overall),
    breakdown: computeCategoryBreakdown(pages),
    pageScores,
    penalties,
  };
}

// ─── Grade lookup ─────────────────────────────────────────────────────────────

export function scoreToGrade(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 45) return 'D';
  return 'F';
}

/** Grade description for display */
export function gradeLabel(grade: Grade): string {
  switch (grade) {
    case 'A': return 'Excellent';
    case 'B': return 'Good';
    case 'C': return 'Needs Work';
    case 'D': return 'Poor';
    case 'F': return 'Critical Issues';
  }
}

/** Colour token mapped to existing CSS variables in globals.css */
export function gradeColor(grade: Grade): string {
  switch (grade) {
    case 'A': return 'var(--success)';
    case 'B': return '#7dc26d';
    case 'C': return 'var(--warning, #f5a623)';
    case 'D': return '#e87b2a';
    case 'F': return 'var(--error)';
  }
}
