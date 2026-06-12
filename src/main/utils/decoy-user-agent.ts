/**
 * Decoy User-Agent installer.
 *
 * Some Claude / OpenAI relay services run a WAF that 403-blocks requests whose
 * User-Agent matches the official Anthropic / OpenAI SDK fingerprint. Their
 * intent is to stop drop-in SDK clients from hammering them.
 *
 * To let users connect through such relays, we install a global undici
 * dispatcher that rewrites the User-Agent of every outbound fetch to a neutral
 * value (default: curl/8.4.0). The change is process-wide so all SDK clients —
 * including pi-coding-agent's internal Anthropic instance — get covered
 * without us having to edit each `new Anthropic(...)` call site.
 *
 * Opt-out: set SIDEKICK_DISABLE_DECOY_UA=1 in the environment to restore the
 * original SDK behavior.
 *
 * Override the decoy value: SIDEKICK_DECOY_USER_AGENT="my-custom-ua/1.0"
 */

import { Agent, setGlobalDispatcher } from 'undici';
import { log } from './logger';

const DEFAULT_DECOY_UA = 'curl/8.4.0';
let installed = false;
let effectiveUA: string | null = null;

function decoyUserAgent(): string {
  if (effectiveUA !== null) return effectiveUA;
  const override = process.env.SIDEKICK_DECOY_USER_AGENT?.trim();
  effectiveUA = override && override.length > 0 ? override : DEFAULT_DECOY_UA;
  return effectiveUA;
}

/**
 * Headers object to pass into SDK constructors that accept `defaultHeaders`
 * (e.g. new Anthropic({ defaultHeaders: getDecoyHeaders() })).
 *
 * Belt-and-suspenders: undici interception below already covers the wire, but
 * setting it at the SDK layer too prevents the SDK from re-adding its UA on
 * top via header merge logic.
 */
export function getDecoyHeaders(): Record<string, string> {
  if (process.env.SIDEKICK_DISABLE_DECOY_UA === '1') {
    return {};
  }
  return { 'User-Agent': decoyUserAgent() };
}

/**
 * Install a process-wide undici dispatcher that rewrites every outbound
 * request's User-Agent. Call once during main-process startup.
 */
export function installDecoyUserAgent(): void {
  if (installed) return;
  if (process.env.SIDEKICK_DISABLE_DECOY_UA === '1') {
    log('[DecoyUA] disabled by SIDEKICK_DISABLE_DECOY_UA=1');
    installed = true;
    return;
  }

  const ua = decoyUserAgent();

  // Layer 1 — undici global dispatcher (covers everything that uses
  // undici's connection pool, including most native fetch() users).
  const agent = new Agent();
  const originalDispatch = agent.dispatch.bind(agent);
  agent.dispatch = (opts, handler) => {
    rewriteUserAgent(opts, ua);
    return originalDispatch(opts, handler);
  };
  setGlobalDispatcher(agent);

  // Layer 2 — globalThis.fetch wrapper (belt-and-suspenders for SDKs that
  // bundle their own dispatcher or set User-Agent inside the Request init,
  // where undici can't see it without parsing the Request again).
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === 'function') {
    const wrapped: typeof fetch = async (input, init) => {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      );
      headers.set('user-agent', ua);
      const nextInit: RequestInit = { ...(init ?? {}), headers };
      return originalFetch(input as RequestInfo, nextInit);
    };
    globalThis.fetch = wrapped;
  }

  installed = true;
  log(`[DecoyUA] installed (undici + fetch wrapper); UA="${ua}"`);
}

interface DispatchOptionsLike {
  headers?: unknown;
}

function rewriteUserAgent(opts: DispatchOptionsLike, ua: string): void {
  const headers = opts.headers;
  if (!headers) {
    opts.headers = { 'user-agent': ua };
    return;
  }

  if (Array.isArray(headers)) {
    // undici accepts flat [name, value, name, value, ...] arrays
    let replaced = false;
    for (let i = 0; i < headers.length - 1; i += 2) {
      const name = headers[i];
      if (typeof name === 'string' && name.toLowerCase() === 'user-agent') {
        headers[i + 1] = ua;
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      headers.push('user-agent', ua);
    }
    return;
  }

  if (typeof headers === 'object') {
    const obj = headers as Record<string, unknown>;
    let foundKey: string | null = null;
    for (const key of Object.keys(obj)) {
      if (key.toLowerCase() === 'user-agent') {
        foundKey = key;
        break;
      }
    }
    if (foundKey) {
      obj[foundKey] = ua;
    } else {
      obj['user-agent'] = ua;
    }
  }
}
