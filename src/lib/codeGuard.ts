/**
 * src/lib/codeGuard.ts
 *
 * Security guard for AI-generated and user-supplied Playwright code.
 * Blocks Node.js system-access patterns before execution.
 *
 * NOTE: This is defense-in-depth for a local/internal tool. Before any
 * external deployment, replace new AsyncFunction() with a proper sandbox
 * (e.g., isolated-vm).
 */

export const DANGEROUS_CODE_PATTERNS: RegExp[] = [
  /\brequire\s*\(/,
  /\bprocess\s*\./,
  /\bchild_process\b/,
  /\bfs\s*\.\s*(?:read|write|unlink|mkdir|rm|access|open|stat)/,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bimport\s*\(/,
];

/**
 * Returns the first matched pattern source string if the code contains a
 * dangerous pattern, or null if the code is safe to execute.
 */
export function checkForDangerousCode(code: string): string | null {
  for (const pattern of DANGEROUS_CODE_PATTERNS) {
    if (pattern.test(code)) return pattern.source;
  }
  return null;
}

/**
 * Throws if the code contains a dangerous pattern.
 * Convenience wrapper for call sites that want an exception rather than null.
 */
export function assertSafeCode(code: string): void {
  const match = checkForDangerousCode(code);
  if (match) {
    throw new Error(`Blocked: code contains a disallowed pattern (${match})`);
  }
}
