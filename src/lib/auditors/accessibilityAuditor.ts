import type { Page } from 'playwright';
import type { AccessibilityResult, AxeViolation, AxeViolationNode, AuditIssue } from '@/types/audit';
import { runAxe } from '@/lib/browserManager';

export async function runAccessibilityAudit(page: Page): Promise<AccessibilityResult> {
  let axeRaw: Record<string, unknown>;

  try {
    axeRaw = await runAxe(page);
  } catch {
    // axe.min.js not available or injection failed — return empty result
    return emptyResult('axe-core not available — bundle public/vendor/axe.min.js to enable accessibility checks');
  }

  const rawViolations = (axeRaw.violations as AxeRawViolation[]) || [];
  const rawPasses     = (axeRaw.passes     as unknown[]) || [];
  const rawIncomplete = (axeRaw.incomplete  as unknown[]) || [];

  const impactBreakdown = { critical: 0, serious: 0, moderate: 0, minor: 0 };

  const violations: AxeViolation[] = rawViolations.map(v => {
    const impact = (v.impact || 'minor') as AxeViolation['impact'];
    impactBreakdown[impact] = (impactBreakdown[impact] || 0) + 1;

    const nodes: AxeViolationNode[] = ((v.nodes as AxeRawNode[]) || []).slice(0, 5).map(n => ({
      selector: (n.target || []).join(', '),
      html: (n.html || '').slice(0, 300),
      failureSummary: (n.failureSummary || '').slice(0, 300),
    }));

    return {
      ruleId: v.id || '',
      impact,
      description: v.description || '',
      helpUrl: v.helpUrl || '',
      wcagCriteria: extractWcagCriteria(v.tags || []),
      nodes,
      nodeCount: ((v.nodes as unknown[]) || []).length,
    };
  });

  // Determine WCAG level
  const hasAFailure = violations.some(v =>
    v.wcagCriteria.some(c => c.startsWith('1.') || c.startsWith('2.') || c.startsWith('3.')),
  );
  const hasAAFailure = violations.some(v =>
    v.wcagCriteria.some(c => ['1.4.3', '1.4.4', '1.4.5', '1.4.10', '1.4.11', '1.4.12', '1.4.13',
      '2.4.5', '2.4.6', '2.4.7', '3.1.2', '3.2.3', '3.2.4', '3.3.3', '3.3.4'].includes(c)),
  );
  const wcagLevel = violations.length === 0 ? 'pass-AA' : hasAAFailure ? 'fail-AA' : hasAFailure ? 'fail-A' : 'pass-AA';

  // Map violations to AuditIssue[]
  const issues: AuditIssue[] = violations.map(v => ({
    id: `a11y-${v.ruleId}`,
    severity: axeImpactToSeverity(v.impact),
    category: 'accessibility' as const,
    title: axeRuleTitle(v.ruleId, v.description),
    description: v.description,
    element: v.nodes[0]?.selector,
    value: `${v.nodeCount} element${v.nodeCount !== 1 ? 's' : ''}`,
    wcagCriterion: v.wcagCriteria[0],
    axeRuleId: v.ruleId,
    helpUrl: v.helpUrl,
  }));

  return {
    violations,
    violationCount: violations.length,
    passCount: rawPasses.length,
    incompleteCount: rawIncomplete.length,
    impactBreakdown,
    wcagLevel,
    issues,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface AxeRawViolation {
  id?: string;
  impact?: string;
  description?: string;
  helpUrl?: string;
  tags?: string[];
  nodes?: AxeRawNode[];
}

interface AxeRawNode {
  target?: string[];
  html?: string;
  failureSummary?: string;
}

function extractWcagCriteria(tags: string[]): string[] {
  return tags
    .filter(t => /^wcag\d+a+$/.test(t) || /^wcag\d+\.\d+\.\d+$/.test(t))
    .map(t => {
      const m = t.match(/^wcag(\d)(\d)(\d+)$/);
      return m ? `${m[1]}.${m[2]}.${m[3]}` : t;
    });
}

function axeImpactToSeverity(impact: AxeViolation['impact']): AuditIssue['severity'] {
  switch (impact) {
    case 'critical':  return 'critical';
    case 'serious':   return 'critical';
    case 'moderate':  return 'warning';
    case 'minor':     return 'info';
    default:          return 'info';
  }
}

function axeRuleTitle(ruleId: string, fallback: string): string {
  const titles: Record<string, string> = {
    'image-alt':                  'Images must have alt text',
    'label':                      'Form inputs must have labels',
    'color-contrast':             'Text must have sufficient color contrast',
    'link-name':                  'Links must have accessible names',
    'button-name':                'Buttons must have accessible names',
    'document-title':             'Page must have a title',
    'html-has-lang':              'HTML element must have lang attribute',
    'landmark-one-main':          'Page must have one main landmark',
    'region':                     'Content must be contained in landmark regions',
    'heading-order':              'Heading levels must not skip',
    'duplicate-id':               'IDs must be unique in the DOM',
    'aria-allowed-attr':          'ARIA attributes must match their roles',
    'aria-required-children':     'ARIA roles must have required child roles',
    'aria-required-parent':       'ARIA roles must have required parent roles',
    'aria-valid-attr':            'ARIA attributes must be valid',
    'aria-valid-attr-value':      'ARIA attribute values must be valid',
    'frame-title':                'Frames must have accessible titles',
    'list':                       'List markup must be correct',
    'listitem':                   'List items must be in lists',
    'tabindex':                   'tabindex must not exceed 0',
    'video-caption':              'Videos must have captions',
  };
  return titles[ruleId] || fallback.slice(0, 80);
}

function emptyResult(infoMessage: string): AccessibilityResult {
  return {
    violations: [],
    violationCount: 0,
    passCount: 0,
    incompleteCount: 0,
    impactBreakdown: { critical: 0, serious: 0, moderate: 0, minor: 0 },
    wcagLevel: 'pass-AA',
    issues: [{
      id: 'a11y-axe-unavailable',
      severity: 'info',
      category: 'accessibility',
      title: 'Accessibility check skipped',
      description: infoMessage,
    }],
  };
}
