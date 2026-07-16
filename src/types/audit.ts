/**
 * src/types/audit.ts
 *
 * Single source of truth for all types in the Website Audit Platform.
 * Every audit module, API route, and UI component imports from here.
 * No runtime code — type definitions only.
 */

// ─── Primitive literals ───────────────────────────────────────────────────────

export type CrawlMode = 'single' | 'topPages' | 'fullCrawl';

export type AuditCategory =
  | 'seo'
  | 'accessibility'
  | 'performance'
  | 'security'
  | 'uiux'
  | 'content'
  | 'tech'
  | 'functional'
  | 'visual';

export type IssueSeverity = 'critical' | 'warning' | 'info';

export type AuditJobStatus =
  | 'queued'
  | 'crawling'
  | 'auditing'
  | 'generating'
  | 'complete'
  | 'error';

/**
 * Depth of audit run on a single page, driven by crawl mode and page rank.
 *
 * full         — all phases (SEO, a11y, perf, security, UI/UX, content, tech)
 * seo_links    — SEO + link extraction only (used for non-priority pages in full crawl)
 * seo_only     — SEO snapshot only (status code, title, meta — used for deep crawls)
 */
export type PageAuditDepth = 'full' | 'seo_links' | 'seo_only';

export type FixType =
  | 'html'
  | 'css'
  | 'javascript'
  | 'server-config'
  | 'content'
  | 'playwright';

export type EffortLevel = 'quick' | 'medium' | 'complex';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export type TestPriority = 'high' | 'medium' | 'low';

export type TestCategory =
  | 'navigation'
  | 'form'
  | 'content'
  | 'accessibility'
  | 'performance'
  | 'security'
  | 'visual';

export type VisualArea =
  | 'layout'
  | 'cta'
  | 'navigation'
  | 'typography'
  | 'spacing'
  | 'contrast'
  | 'trust'
  | 'mobile';

// ─── Audit configuration ──────────────────────────────────────────────────────

export interface AuditConfig {
  /** Normalized starting URL (always https:// or http://) */
  url: string;
  crawlMode: CrawlMode;
  /**
   * Maximum pages to crawl.
   * Defaults: single=1, topPages=10, fullCrawl=50
   */
  maxPages: number;
  /** Minimum milliseconds between requests to the same domain during crawl. */
  crawlDelayMs: number;
  /** Which audit categories to run. Omitting a category skips it entirely. */
  categories: AuditCategory[];
}

// ─── Job management ───────────────────────────────────────────────────────────

export interface CrawlProgress {
  discovered: number;
  crawled: number;
  queued: number;
  errored: number;
  currentUrl: string;
}

export interface AuditJob {
  jobId: string;
  config: AuditConfig;
  status: AuditJobStatus;
  startedAt: number;
  completedAt?: number;
  /** Short machine-readable phase id, e.g. 'seo', 'accessibility', 'generating_fixes' */
  currentPhase: string;
  /** Human-readable label shown in progress UI */
  currentPhaseLabel: string;
  /** Overall progress 0–100 across all phases */
  totalProgress: number;
  crawlProgress: CrawlProgress;
  error?: string;
}

// ─── Shared issue ─────────────────────────────────────────────────────────────

/**
 * A single finding produced by any audit phase.
 * The `id` is deterministic: '{category}-{slug}', e.g. 'seo-missing-h1'.
 * The same issue found on multiple pages is represented once in
 * SiteWideAnalysis.uniqueIssues with all affected pages in the `pages` array.
 */
export interface AuditIssue {
  id: string;
  severity: IssueSeverity;
  category: AuditCategory;
  title: string;
  description: string;
  /** CSS selector or descriptive element reference */
  element?: string;
  /** The actual value found, e.g. '93 chars' for an over-length title */
  value?: string;
  /** Populated in SiteWideAnalysis; per-page issues leave this undefined */
  pages?: string[];
  /** WCAG criterion reference, e.g. '1.1.1' */
  wcagCriterion?: string;
  /** axe-core rule id, e.g. 'image-alt' */
  axeRuleId?: string;
  helpUrl?: string;
}

// ─── Health score ─────────────────────────────────────────────────────────────

export interface CategoryScores {
  seo: number;
  accessibility: number;
  performance: number;
  security: number;
  uiux: number;
  functional: number;
  content: number;
}

export interface ScorePenalty {
  reason: string;
  count: number;
  deduction: number;
}

export interface PageScoreSummary {
  url: string;
  score: number;
  issueCount: { critical: number; warning: number; info: number };
}

export interface SiteHealthScore {
  overall: number;
  grade: Grade;
  breakdown: CategoryScores;
  pageScores: PageScoreSummary[];
  penalties: ScorePenalty[];
}

// ─── SEO ─────────────────────────────────────────────────────────────────────

export interface HeadingEntry {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

export interface SchemaEntry {
  type: string;
  raw: string;
}

export interface OpenGraphData {
  title: string;
  description: string;
  image: string;
  type: string;
}

export interface TwitterData {
  title: string;
  card: string;
}

export interface PageSeoResult {
  title: string;
  titleLength: number;
  description: string;
  descriptionLength: number;
  keywords: string;
  headings: HeadingEntry[];
  h1Count: number;
  canonical: string;
  canonicalIsSelf: boolean;
  isIndexable: boolean;
  robots: string;
  openGraph: OpenGraphData;
  twitter: TwitterData;
  schema: SchemaEntry[];
  viewport: string;
  lang: string;
  charset: string;
  internalLinkCount: number;
  externalLinkCount: number;
  imageCount: number;
  imagesWithoutAlt: number;
  /** Only populated on homepage */
  sitemapFound: boolean;
  sitemapUrl: string;
  sitemapPageCount: number;
  /** Only populated on homepage */
  robotsTxtFound: boolean;
  robotsTxtDisallowed: string[];
  issues: AuditIssue[];
}

// ─── Accessibility ────────────────────────────────────────────────────────────

export interface AxeViolationNode {
  selector: string;
  html: string;
  failureSummary: string;
}

export interface AxeViolation {
  ruleId: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  description: string;
  helpUrl: string;
  wcagCriteria: string[];
  nodes: AxeViolationNode[];
  nodeCount: number;
}

export interface AccessibilityResult {
  violations: AxeViolation[];
  violationCount: number;
  passCount: number;
  incompleteCount: number;
  impactBreakdown: {
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
  };
  /** Highest WCAG level passing: 'pass-AA' | 'fail-A' | 'fail-AA' */
  wcagLevel: 'pass-AA' | 'fail-A' | 'fail-AA';
  issues: AuditIssue[];
}

// ─── Performance ──────────────────────────────────────────────────────────────

export interface ResourceBreakdown {
  jsBytes: number;
  cssBytes: number;
  imageBytes: number;
  fontBytes: number;
  otherBytes: number;
  totalBytes: number;
}

export interface RenderBlockingResource {
  url: string;
  type: 'stylesheet' | 'script';
  sizeBytes: number;
}

export interface OversizedImage {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  displayWidth: number;
  displayHeight: number;
  estimatedWastedBytes: number;
}

export interface PerformanceResult {
  loadTimeMs: number;
  domContentLoadedMs: number;
  domInteractiveMs: number;
  firstContentfulPaintMs: number;
  largestContentfulPaintMs: number;
  timeToInteractiveMs: number;
  totalBlockingTimeMs: number;
  resourceBreakdown: ResourceBreakdown;
  resourceCount: number;
  renderBlocking: RenderBlockingResource[];
  oversizedImages: OversizedImage[];
  issues: AuditIssue[];
}

// ─── Security ─────────────────────────────────────────────────────────────────

export interface SecurityHeaderStatus {
  header: string;
  /** required: should always be present; recommended: best practice; deprecated: should be removed */
  tier: 'required' | 'recommended' | 'deprecated';
  present: boolean;
  value: string | null;
}

export interface MixedContentItem {
  url: string;
  type: 'image' | 'script' | 'stylesheet' | 'iframe' | 'other';
  element: string;
}

export interface CookieIssue {
  name: string;
  missingHttpOnly: boolean;
  missingSecure: boolean;
  missingSameSite: boolean;
}

export interface SecurityResult {
  isHttps: boolean;
  sslValid: boolean;
  /** ISO date string or null if HTTP or could not determine */
  sslExpiry: string | null;
  sslDaysRemaining: number | null;
  headers: SecurityHeaderStatus[];
  mixedContent: MixedContentItem[];
  cookieIssues: CookieIssue[];
  issues: AuditIssue[];
}

// ─── UI/UX ────────────────────────────────────────────────────────────────────

export interface OverflowElement {
  selector: string;
  scrollWidth: number;
  clientWidth: number;
  overflowPx: number;
}

export interface TapTarget {
  selector: string;
  text: string;
  widthPx: number;
  heightPx: number;
}

export interface UiUxResult {
  overflowElements: OverflowElement[];
  tapTargetFailures: TapTarget[];
  ctaAboveFold: boolean;
  ctaElements: string[];
  hiddenImportantElements: { selector: string; reason: string }[];
  issues: AuditIssue[];
}

// ─── Content ──────────────────────────────────────────────────────────────────

export interface TrustSignals {
  phoneFound: boolean;
  emailFound: boolean;
  addressFound: boolean;
  privacyPolicyLinked: boolean;
  termsLinked: boolean;
}

export interface ContentResult {
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  /** Flesch-Kincaid Reading Ease score 0–100. Higher = easier to read. */
  readabilityScore: number;
  /** e.g. 'Very Easy' | 'Easy' | 'Fairly Easy' | 'Standard' | 'Fairly Difficult' | 'Difficult' | 'Very Difficult' */
  readabilityGrade: string;
  ctaCount: number;
  ctaElements: string[];
  trustSignals: TrustSignals;
  issues: AuditIssue[];
}

// ─── Technology Detection ─────────────────────────────────────────────────────

export interface TechSignal {
  name: string;
  category: 'framework' | 'cms' | 'analytics' | 'cdn' | 'server' | 'library' | 'ecommerce';
  confidence: 'definite' | 'probable' | 'possible';
  evidence: string;
  version?: string;
}

export interface TechDetectionResult {
  framework: string | null;
  cms: string | null;
  ecommerce: string | null;
  analytics: string[];
  cdn: string | null;
  server: string | null;
  jsLibraries: string[];
  detected: TechSignal[];
}

// ─── Functional ───────────────────────────────────────────────────────────────

export interface BrokenLink {
  url: string;
  statusCode: number;
  text: string;
  /** URL of the page where this link was found */
  foundOn: string;
}

export interface DeadButton {
  selector: string;
  text: string;
  reason: string;
}

export interface RedirectChain {
  startUrl: string;
  chain: string[];
  hops: number;
  finalStatusCode: number;
}

export interface FunctionalResult {
  /** Broken links found on this page (verified via HEAD requests) */
  brokenLinks: BrokenLink[];
  deadButtons: DeadButton[];
  redirectChains: RedirectChain[];
  formsWithoutAction: number;
  issues: AuditIssue[];
}

// ─── Visual Analysis ──────────────────────────────────────────────────────────

export interface VisualIssue {
  id: string;
  severity: IssueSeverity;
  area: VisualArea;
  description: string;
  viewport: 'desktop' | 'mobile';
}

export interface VisualAnalysisResult {
  model: string;
  desktopLayoutScore: number;
  mobileLayoutScore: number | null;
  ctaVisibility: 'prominent' | 'visible' | 'hard_to_find' | 'missing';
  navigationClarity: 'clear' | 'adequate' | 'confusing';
  mobileReadability: 'good' | 'acceptable' | 'poor' | null;
  visualIssues: VisualIssue[];
  positives: string[];
  /** Full raw response from gemma4 for desktop viewport */
  desktopAnalysis: string;
  /** Full raw response from gemma4 for mobile viewport, if run */
  mobileAnalysis: string | null;
}

// ─── Per-page result ──────────────────────────────────────────────────────────

export interface PageScreenshots {
  /** Base64-encoded PNG, always present */
  desktop: string;
  /** Present only when auditDepth is 'full' */
  mobile: string | null;
  /** Present only when auditDepth is 'full' */
  tablet: string | null;
}

export interface PageAuditResult {
  url: string;
  title: string;
  statusCode: number;
  /** Empty array if no redirects occurred */
  redirectChain: string[];
  loadTimeMs: number;
  auditDepth: PageAuditDepth;
  pageScore: number;
  screenshots: PageScreenshots;

  // Category results — null when the category was not run at this audit depth
  seo: PageSeoResult;
  accessibility: AccessibilityResult | null;
  performance: PerformanceResult | null;
  /** Only populated for the homepage in multi-page modes */
  security: SecurityResult | null;
  uiux: UiUxResult | null;
  content: ContentResult | null;
  /** Only populated for the homepage in multi-page modes */
  tech: TechDetectionResult | null;
  functional: FunctionalResult | null;
  visualAnalysis: VisualAnalysisResult | null;

  consoleErrors: string[];
  /** All issues from this page merged from all categories that ran */
  issues: AuditIssue[];
}

// ─── Site-wide aggregation ────────────────────────────────────────────────────

export interface DuplicateGroup {
  value: string;
  pages: string[];
}

export interface SiteWideAnalysis {
  /** All issues de-duped across all pages; each issue has pages[] populated */
  uniqueIssues: AuditIssue[];
  duplicateTitles: DuplicateGroup[];
  duplicateDescriptions: DuplicateGroup[];
  missingTitlePages: string[];
  missingDescriptionPages: string[];
  missingH1Pages: string[];
  pagesWithoutCanonical: string[];
  nonIndexablePages: string[];
  /** Pages with zero inbound internal links from other crawled pages */
  orphanPages: string[];
  /** Aggregated broken links from all pages after HEAD verification */
  brokenLinks: BrokenLink[];
  redirectChains: RedirectChain[];
  averageLoadTimeMs: number;
  slowestPages: { url: string; loadTimeMs: number }[];
  issueCount: { critical: number; warning: number; info: number };
}

// ─── Crawl summary ────────────────────────────────────────────────────────────

export interface CrawlSummary {
  mode: CrawlMode;
  pagesDiscovered: number;
  pagesCrawled: number;
  pagesErrored: number;
  crawlDurationMs: number;
  sitemapFound: boolean;
  sitemapUrl: string;
  sitemapPageCount: number;
  robotsTxtFound: boolean;
  robotsTxtContent: string;
  robotsTxtDisallowed: string[];
  crawlDelayUsedMs: number;
}

// ─── AI-generated outputs ─────────────────────────────────────────────────────

export interface AiRecommendation {
  id: string;
  /** Issue IDs this recommendation addresses — one rec may cover multiple issues */
  issueIds: string[];
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: AuditCategory;
  title: string;
  /** Business impact statement: "This affects all mobile users and impacts conversion" */
  impact: string;
  recommendation: string;
  suggestedFix: string;
  effort: EffortLevel;
  affectedPages: string[];
}

export interface QaTestStep {
  stepNumber: number;
  action: string;
}

export interface QaTestCase {
  id: string;
  title: string;
  category: TestCategory;
  priority: TestPriority;
  targetUrl: string;
  preconditions: string;
  steps: QaTestStep[];
  expectedResult: string;
  relatedIssueId?: string;
  /** BDD Given/When/Then format for import into TestRail, Jira, Zoho Sprints */
  gherkin: string;
}

export interface PlaywrightTestSuite {
  generatedAt: number;
  targetUrl: string;
  crawlMode: CrawlMode;
  /** Complete runnable Playwright JS — compatible with Standard Automation editor */
  script: string;
  testCount: number;
  coverageAreas: string[];
}

export interface FixItem {
  id: string;
  issueId: string;
  title: string;
  category: AuditCategory;
  severity: IssueSeverity;
  fixType: FixType;
  /** Language for syntax highlighting: 'html' | 'css' | 'javascript' | 'nginx' */
  language: string;
  /** Ready-to-apply code snippet */
  codeSnippet: string;
  /** Original problematic code (null if not applicable) */
  beforeCode: string | null;
  /** Fixed version of the code (null if not applicable) */
  afterCode: string | null;
  affectedPages: string[];
  effort: EffortLevel;
  /** site_wide: fix applies once globally; single_page: applies per-page */
  applyScope: 'single_page' | 'site_wide';
}

// ─── Top-level site audit result ─────────────────────────────────────────────

export interface SiteAuditResult {
  jobId: string;
  config: AuditConfig;
  auditedAt: number;
  durationMs: number;
  crawlSummary: CrawlSummary;
  healthScore: SiteHealthScore;
  /** One entry per crawled page, ordered by discovery */
  pages: PageAuditResult[];
  siteWide: SiteWideAnalysis;
  recommendations: AiRecommendation[];
  qaTestCases: QaTestCase[];
  /** null if Playwright generation did not run or failed */
  playwrightSuite: PlaywrightTestSuite | null;
  fixes: FixItem[];
}

// ─── Audit history ────────────────────────────────────────────────────────────

export interface AuditIndexEntry {
  jobId: string;
  url: string;
  domain: string;
  crawlMode: CrawlMode;
  pagesCrawled: number;
  auditedAt: number;
  durationMs: number;
  healthScore: number;
  grade: Grade;
  issueCount: { critical: number; warning: number; info: number };
}

// ─── SSE event union ──────────────────────────────────────────────────────────

export interface SsePhaseStartEvent {
  type: 'phase_start';
  phase: string;
  phaseLabel: string;
  totalProgress: number;
}

export interface SsePhaseCompleteEvent {
  type: 'phase_complete';
  phase: string;
  phaseLabel: string;
  totalProgress: number;
}

export interface SsePageStartEvent {
  type: 'page_start';
  url: string;
  pageIndex: number;
  totalPages: number;
}

export interface SsePageCompleteEvent {
  type: 'page_complete';
  url: string;
  pageIndex: number;
  pageScore: number;
  issueCount: { critical: number; warning: number; info: number };
}

export interface SseCrawlProgressEvent {
  type: 'crawl_progress';
  discovered: number;
  crawled: number;
  queued: number;
  errored: number;
  currentUrl: string;
}

export interface SseIssueFoundEvent {
  type: 'issue_found';
  issue: AuditIssue;
  pageUrl: string;
}

export interface SseCompleteEvent {
  type: 'complete';
  healthScore: number;
  grade: Grade;
  durationMs: number;
  pagesCrawled: number;
  issueCount: { critical: number; warning: number; info: number };
}

export interface SseErrorEvent {
  type: 'error';
  message: string;
  phase?: string;
}

export interface SseKeepaliveEvent {
  type: 'keepalive';
}

export type AuditSSEEvent =
  | SsePhaseStartEvent
  | SsePhaseCompleteEvent
  | SsePageStartEvent
  | SsePageCompleteEvent
  | SseCrawlProgressEvent
  | SseIssueFoundEvent
  | SseCompleteEvent
  | SseErrorEvent
  | SseKeepaliveEvent;

// ─── Capabilities response ────────────────────────────────────────────────────

export interface AuditCapabilities {
  ollamaReachable: boolean;
  textModel: string;
  visionModel: string | null;
  hasVision: boolean;
  axeCoreAvailable: boolean;
}
