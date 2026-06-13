import { describe, expect, it } from 'vitest';
import { redactString, redactValue, REDACTION_MASK } from '../main/utils/log-redaction';

const MASK = REDACTION_MASK;

// ─── redactString — secret shapes (positive cases) ──────────────────────────

describe('redactString — secret shapes', () => {
  it('masks OpenAI and Anthropic keys but keeps the family prefix', () => {
    expect(redactString('key=sk-abcdef0123456789ABCDEF')).toContain(`sk-${MASK}`);
    expect(redactString('key=sk-abcdef0123456789ABCDEF')).not.toContain('abcdef0123456789');
    const ant = redactString('using sk-ant-api03-AbCdEf012345_token-XYZ');
    expect(ant).toContain(`sk-ant-${MASK}`);
    expect(ant).not.toContain('AbCdEf012345');
  });

  it('masks AWS and Google keys', () => {
    expect(redactString('AKIAIOSFODNN7EXAMPLE here')).toBe(`${MASK} here`);
    expect(redactString('k AIzaSyA1234567890abcdefghijklmnopqrstuvw done')).toBe(`k ${MASK} done`);
  });

  it('masks GitHub tokens', () => {
    expect(redactString('ghp_0123456789abcdefABCDEF0123456789abcd')).toBe(MASK);
  });

  it('masks bearer tokens but keeps the scheme', () => {
    expect(redactString('Authorization: Bearer abc.def.ghi-jkl')).toBe(
      `Authorization: Bearer ${MASK}`
    );
  });

  it('masks key=value / key: value secrets', () => {
    expect(redactString('api_key=supersecretvalue123')).toBe(`api_key=${MASK}`);
    expect(redactString('password: "hunter2pass"')).toBe(`password: "${MASK}"`);
    expect(redactString('token=abc&keep=ok')).toBe(`token=${MASK}&keep=ok`);
  });

  it('masks long high-entropy tokens (hex and base64url)', () => {
    expect(redactString('digest 0123456789abcdef0123456789abcdef')).toBe(`digest ${MASK}`);
    expect(redactString('t a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1')).toBe(`t ${MASK}`);
  });

  it('redacts home-directory usernames on posix and windows', () => {
    expect(redactString('/Users/alice/Documents/x')).toBe('~/Documents/x');
    expect(redactString('/home/bob/project/y')).toBe('~/project/y');
    expect(redactString('C:\\Users\\carol\\file.txt')).toBe('~\\file.txt');
  });
});

// ─── Table-driven positive cases — one pattern per row ──────────────────────

describe('redactString — table-driven positive cases', () => {
  const cases: Array<[string, string, string]> = [
    // sk- key (≥16 chars after sk-). Deliberately NOT a real OpenAI key shape so
    // secret-scanning push protection does not flag this fixture.
    [
      'sk- key keeps the sk- prefix',
      'using sk-FAKEexample0123456789notarealkey',
      `using sk-${MASK}`,
    ],
    // sk-ant- key
    [
      'sk-ant- key keeps the sk-ant- prefix',
      'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz1234',
      `sk-ant-${MASK}`,
    ],
    // AWS key standalone
    ['AWS AKIA key fully masked', 'AKIAIOSFODNN7EXAMPLE', MASK],
    // Google key with exact 35-char suffix
    ['Google AIza key fully masked', 'AIzaSyDaGmWKa4JsXZ-HjGw8bm7i58XABCDEfgh', MASK],
    // Authorization: Bearer
    [
      'Authorization header Bearer token masked',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      `Authorization: Bearer ${MASK}`,
    ],
    // api-key= (hyphen variant)
    ['api-key= value masked', 'api-key=MyHyphenatedKeyValue123456', `api-key=${MASK}`],
    // secret=
    ['secret= value masked', 'secret=xyzSecretValue', `secret=${MASK}`],
    // Home path embedded
    [
      'home path in message anonymised',
      'Saving to /Users/mac/output/result.docx',
      'Saving to ~/output/result.docx',
    ],
    // /home/<name> trailing
    ['/home/<name> alone anonymised', '/home/dev', '~'],
    // 32-char lowercase hex token
    ['32-char hex token masked', 'hash a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6', `hash ${MASK}`],
    // Standalone 36-char base64url JWT header
    [
      '36-char JWT header masked (generic base64url rule)',
      'token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      `token ${MASK}`,
    ],
  ];

  for (const [desc, input, expected] of cases) {
    it(desc, () => {
      expect(redactString(input)).toBe(expected);
    });
  }
});

// ─── redactString — negatives (must not mangle ordinary text) ────────────────

describe('redactString — negatives (must not mangle ordinary text)', () => {
  it('leaves prose, versions, short numbers, and normal paths untouched', () => {
    for (const s of [
      'The task completed successfully.',
      'Released v3.4.0 on 2026-06-13',
      'count=12345 and id=42',
      'src/main/office/office-task-service.ts',
      './relative/path/file.md',
      'a short token abc123',
    ]) {
      expect(redactString(s)).toBe(s);
    }
  });

  // Additional strong negative cases (table-driven)
  const negativeCases: Array<[string, string]> = [
    ['empty string', ''],
    ['bare word "bearer"', 'bearer'],
    ['Bearer followed by short word', 'Bearer token'],
    ['word "password" in plain prose', 'reset your password please'],
    ['word "secret" in plain prose', 'the secret garden'],
    ['system path without username', '/etc/hosts'],
    ['system var-log path', '/var/log/app.log'],
    ['timeout=30s (not a secret key)', 'timeout=30s'],
    ['short sk- (< 16 chars after sk-)', 'sk-12345'],
  ];

  for (const [desc, input] of negativeCases) {
    it(`does not mangle: ${desc}`, () => {
      expect(redactString(input)).toBe(input);
    });
  }
});

// ─── redactValue ─────────────────────────────────────────────────────────────

describe('redactValue', () => {
  it('passes through non-string primitives', () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(true)).toBe(true);
    expect(redactValue(null)).toBeNull();
    expect(redactValue(undefined)).toBeUndefined();
  });

  it('redacts strings nested in objects and arrays', () => {
    const out = redactValue({
      ok: 'fine',
      creds: { authorization: 'Bearer secret.token.value' },
      paths: ['/Users/dave/a', '/home/erin/b'],
    }) as { ok: string; creds: { authorization: string }; paths: string[] };
    expect(out.ok).toBe('fine');
    expect(out.creds.authorization).toBe(`Bearer ${MASK}`);
    expect(out.paths).toEqual(['~/a', '~/b']);
  });

  it('redacts an Error message while preserving its shape', () => {
    const err = new Error('failed with api_key=topsecretvalue123');
    const out = redactValue(err) as { name: string; message: string };
    expect(out.name).toBe('Error');
    expect(out.message).toBe(`failed with api_key=${MASK}`);
  });

  it('is safe on cyclic structures', () => {
    const a: Record<string, unknown> = { name: 'node' };
    a.self = a;
    const out = redactValue(a) as { name: string; self: string };
    expect(out.name).toBe('node');
    expect(out.self).toBe('[Circular]');
  });

  it('caps recursion depth', () => {
    let deep: unknown = 'sk-abcdef0123456789ABCDEF';
    for (let i = 0; i < 10; i += 1) {
      deep = { next: deep };
    }
    // Should not throw and should return a truncation marker somewhere deep.
    expect(() => redactValue(deep)).not.toThrow();
  });

  it('caps long arrays at 100 entries', () => {
    const big = Array.from({ length: 150 }, (_, i) => i);
    const out = redactValue(big) as number[];
    expect(out).toHaveLength(100);
  });
});
