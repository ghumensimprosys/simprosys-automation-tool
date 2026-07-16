import type { Page } from 'playwright';
import type { ContentResult, TrustSignals, AuditIssue } from '@/types/audit';

export async function runContentAudit(page: Page): Promise<ContentResult> {
  const data = await page.evaluate(() => {
    // ─── Extract visible text ──────────────────────────────────────────────────
    const bodyClone = document.body.cloneNode(true) as HTMLElement;
    for (const el of Array.from(bodyClone.querySelectorAll('script, style, nav, header, footer, [aria-hidden="true"]'))) {
      el.remove();
    }
    const rawText = (bodyClone.textContent || '').replace(/\s+/g, ' ').trim();

    // ─── Word / sentence counts ───────────────────────────────────────────────
    const words = rawText.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;
    const sentences = rawText.split(/[.!?]+\s/).filter(s => s.trim().length > 0);
    const sentenceCount = sentences.length;
    const paragraphs = Array.from(bodyClone.querySelectorAll('p, li, blockquote'));
    const paragraphCount = paragraphs.length;

    // ─── Flesch-Kincaid Reading Ease ──────────────────────────────────────────
    // Formula: 206.835 - 1.015*(words/sentences) - 84.6*(syllables/words)
    // Syllable counting: count vowel groups per word (simplified approximation)
    function countSyllables(word: string): number {
      const w = word.toLowerCase().replace(/[^a-z]/g, '');
      if (w.length <= 3) return 1;
      let count = (w.match(/[aeiouy]+/g) || []).length;
      if (w.endsWith('e') && count > 1) count--; // silent e
      return Math.max(1, count);
    }
    const syllableCount = words.reduce((s, w) => s + countSyllables(w), 0);
    const asl = sentenceCount > 0 ? wordCount / sentenceCount : wordCount;  // avg sentence length
    const asw = wordCount > 0 ? syllableCount / wordCount : 0;              // avg syllables per word
    const fleschScore = wordCount < 20 ? 60 : Math.round(206.835 - 1.015 * asl - 84.6 * asw);
    const clampedScore = Math.max(0, Math.min(100, fleschScore));

    const readabilityGrade = (score: number): string => {
      if (score >= 90) return 'Very Easy';
      if (score >= 80) return 'Easy';
      if (score >= 70) return 'Fairly Easy';
      if (score >= 60) return 'Standard';
      if (score >= 50) return 'Fairly Difficult';
      if (score >= 30) return 'Difficult';
      return 'Very Difficult';
    };

    // ─── Trust signals ────────────────────────────────────────────────────────
    const bodyText = document.body.innerText.toLowerCase();
    const phoneFound   = /(\+?\d[\d\s\-().]{7,}\d)/.test(bodyText);
    const emailFound   = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(bodyText);
    const addressFound = /\b(street|st\.|avenue|ave\.|road|rd\.|suite|ste\.|floor|blvd|drive|dr\.)\b/i.test(bodyText);

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
    const linkTexts = links.map(a => (a.textContent || a.href).toLowerCase());
    const privacyPolicyLinked = linkTexts.some(t => t.includes('privacy') || t.includes('privacy policy'));
    const termsLinked = linkTexts.some(t =>
      t.includes('terms') || t.includes('terms of service') || t.includes('terms and conditions'),
    );

    // ─── CTA elements ─────────────────────────────────────────────────────────
    const CTA_PATTERNS = /\b(buy|shop|get started|start free|sign up|subscribe|order|checkout|add to cart|try free|demo|contact us|book|schedule|download|install|get a quote|request a demo)\b/i;
    const ctaEls: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('a, button, input[type="submit"]')).slice(0, 100)) {
      const text = (el.textContent || el.getAttribute('value') || el.getAttribute('aria-label') || '').trim();
      if (CTA_PATTERNS.test(text)) ctaEls.push(text.slice(0, 60));
    }

    return {
      wordCount, sentenceCount, paragraphCount,
      readabilityScore: clampedScore,
      readabilityGrade: readabilityGrade(clampedScore),
      ctaCount: ctaEls.length,
      ctaElements: ctaEls.slice(0, 10),
      trustSignals: { phoneFound, emailFound, addressFound, privacyPolicyLinked, termsLinked },
    };
  });

  // ─── Build issues ──────────────────────────────────────────────────────────
  const issues: AuditIssue[] = [];
  const add = (
    id: string, severity: AuditIssue['severity'],
    title: string, description: string, extras: Partial<AuditIssue> = {},
  ) => issues.push({ id, severity, category: 'content', title, description, ...extras });

  if (data.wordCount < 100) {
    add('content-thin', 'warning', 'Thin content',
      `Only ${data.wordCount} words found. Pages with under 300 words may be considered thin content by search engines.`,
      { value: `${data.wordCount} words` });
  } else if (data.wordCount < 300) {
    add('content-thin', 'info', 'Low word count',
      `${data.wordCount} words found. Consider expanding content to at least 300 words for better search visibility.`,
      { value: `${data.wordCount} words` });
  }

  if (data.readabilityScore < 30) {
    add('content-readability-poor', 'warning', 'Very difficult to read',
      `Flesch-Kincaid score: ${data.readabilityScore} (${data.readabilityGrade}). Use shorter sentences and simpler vocabulary.`,
      { value: `Score: ${data.readabilityScore}` });
  } else if (data.readabilityScore < 50) {
    add('content-readability-difficult', 'info', 'Content is difficult to read',
      `Flesch-Kincaid score: ${data.readabilityScore} (${data.readabilityGrade}). Consider simplifying language for a wider audience.`,
      { value: `Score: ${data.readabilityScore}` });
  }

  if (!data.trustSignals.privacyPolicyLinked) {
    add('content-missing-privacy', 'warning', 'No privacy policy link detected',
      'A privacy policy link was not found. This is legally required in many jurisdictions (GDPR, CCPA).');
  }

  if (!data.trustSignals.termsLinked) {
    add('content-missing-terms', 'info', 'No terms of service link detected',
      'No terms of service/conditions link was found. This is recommended for trust and legal protection.');
  }

  if (!data.trustSignals.phoneFound && !data.trustSignals.emailFound && !data.trustSignals.addressFound) {
    add('content-no-contact-info', 'info', 'No contact information detected',
      'No phone, email, or address was found. Contact information builds trust with visitors.');
  }

  if (data.ctaCount === 0) {
    add('content-no-cta', 'info', 'No clear calls-to-action',
      'No call-to-action text was detected. Every page should guide visitors toward a specific action.');
  }

  return {
    wordCount: data.wordCount,
    sentenceCount: data.sentenceCount,
    paragraphCount: data.paragraphCount,
    readabilityScore: data.readabilityScore,
    readabilityGrade: data.readabilityGrade,
    ctaCount: data.ctaCount,
    ctaElements: data.ctaElements,
    trustSignals: data.trustSignals as TrustSignals,
    issues,
  };
}
