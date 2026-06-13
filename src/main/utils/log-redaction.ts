/**
 * Secret / PII redaction for logs.
 *
 * Pure module — no electron, no fs, no `any`. Use these before logging any
 * value that may contain credentials or user paths, so log files never leak
 * API keys, bearer tokens, or the operator's home-directory username.
 *
 * `redactString` masks known secret shapes inside a string. `redactValue`
 * walks an arbitrary value (objects, arrays, Errors) and redacts every string
 * it finds, with a depth/size cap so it is safe on large or cyclic structures.
 */

/** The fixed string that replaces any redacted secret. */
export const REDACTION_MASK = '***REDACTED***';
const MASK = REDACTION_MASK;
const MAX_DEPTH = 6;
const MAX_ARRAY = 100;
const MAX_KEYS = 100;

interface RedactionRule {
  pattern: RegExp;
  replacement: string;
}

// Order matters: more specific shapes first (e.g. sk-ant- before sk-), and the
// broad high-entropy-token rule last so it never pre-empts a prefixed key.
const RULES: RedactionRule[] = [
  // Anthropic keys (keep the family prefix for debuggability).
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{8,}/g, replacement: `sk-ant-${MASK}` },
  // OpenAI / generic sk- keys.
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}/g, replacement: `sk-${MASK}` },
  // AWS access key id.
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: MASK },
  // Google API key.
  { pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g, replacement: MASK },
  // GitHub tokens.
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, replacement: MASK },
  // Authorization / bearer tokens (keep the scheme word). Require ≥8 chars so
  // that a bare word like "Bearer token" (5 chars) is NOT redacted, while real
  // tokens (JWTs, ghp_, opaque strings) are.
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: `Bearer ${MASK}` },
  // key=value / key: value secrets (json, query strings, env dumps).
  {
    pattern:
      /\b(api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|password|passwd|secret|client[_-]?secret)\b(\s*[=:]\s*)("?)([^\s"'&,}]+)\3/gi,
    replacement: `$1$2$3${MASK}$3`,
  },
  // Home directories — drop the username segment so it isn't leaked.
  { pattern: /(?:\/Users\/|\/home\/)[^/\s:"'\\]+/g, replacement: '~' },
  { pattern: /[A-Za-z]:\\Users\\[^\\\s:"']+/g, replacement: '~' },
  // High-entropy standalone tokens last: long hex (hashes/keys) and long
  // base64url-ish tokens that mix letters and digits (so prose words are safe).
  { pattern: /\b[A-Fa-f0-9]{32,}\b/g, replacement: MASK },
  {
    pattern: /\b(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}\b/g,
    replacement: MASK,
  },
];

/** Mask known secret shapes and home-path usernames inside a string. */
export function redactString(input: string): string {
  let output = input;
  for (const rule of RULES) {
    output = output.replace(rule.pattern, rule.replacement);
  }
  return output;
}

/**
 * Recursively redact every string inside an arbitrary value. Non-string
 * primitives pass through unchanged; Errors keep their shape but get a redacted
 * message/stack; depth, array length, and key count are capped so this is safe
 * on huge or cyclic inputs.
 */
export function redactValue(value: unknown): unknown {
  return redactAtDepth(value, 0, new WeakSet());
}

function redactAtDepth(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return '[Truncated]';
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: typeof value.stack === 'string' ? redactString(value.stack) : undefined,
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => redactAtDepth(item, depth + 1, seen));
  }

  const result: Record<string, unknown> = {};
  let count = 0;
  for (const [key, item] of Object.entries(value)) {
    if (count >= MAX_KEYS) {
      result['…'] = '[Truncated]';
      break;
    }
    result[key] = redactAtDepth(item, depth + 1, seen);
    count += 1;
  }
  return result;
}
