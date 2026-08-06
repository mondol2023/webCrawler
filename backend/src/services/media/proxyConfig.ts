/**
 * Proxy plumbing for the media downloader.
 *
 * The user supplies their own proxy or VPN endpoint; we validate it and pass it
 * through to yt-dlp (`--proxy`) and to axios. We do not bundle, host, or
 * discover proxies — this module is transport configuration, nothing more.
 *
 * Credentials must never reach the logs: everything logged goes through
 * `safeLabel`, which strips userinfo.
 */
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { ProxyConfig } from './types';
import { env } from '../../config/env';

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'socks:', 'socks4:', 'socks5:', 'socks5h:']);

export class ProxyConfigError extends Error {}

/** Strips `user:pass@` so a proxy URL is safe to log or return to the client. */
export function maskProxy(raw: string): string {
  try {
    const u = new URL(raw);
    const auth = u.username ? '***@' : '';
    return `${u.protocol}//${auth}${u.host}`;
  } catch {
    return '(malformed proxy)';
  }
}

/**
 * Validates a user-supplied proxy string. Returns `null` when the caller did
 * not ask for a proxy and no server default is configured.
 *
 * @throws ProxyConfigError when a proxy was requested but is unusable — we fail
 *         loudly rather than silently falling back to a direct connection, which
 *         would leak the server's real IP after the user explicitly asked not to.
 */
export function resolveProxy(userSupplied?: string | null): ProxyConfig | null {
  const raw = (userSupplied ?? '').trim() || env.MEDIA_PROXY_URL?.trim() || '';
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ProxyConfigError(
      'Proxy must be a full URL, e.g. http://host:8080 or socks5://user:pass@host:1080'
    );
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new ProxyConfigError(
      `Unsupported proxy scheme "${parsed.protocol.replace(':', '')}". Use http, https, or socks5.`
    );
  }

  if (!parsed.hostname) {
    throw new ProxyConfigError('Proxy URL is missing a host.');
  }

  return { url: parsed.toString(), safeLabel: maskProxy(parsed.toString()) };
}

/**
 * Builds the http/https agents axios needs to route a request through `proxy`.
 * Returns an empty object when there is no proxy, so callers can always spread
 * the result into their axios config.
 */
export function proxyAgents(
  proxy: ProxyConfig | null
): { httpAgent?: unknown; httpsAgent?: unknown; proxy?: false } {
  if (!proxy) return {};

  const scheme = new URL(proxy.url).protocol;
  const agent = scheme.startsWith('socks')
    ? new SocksProxyAgent(proxy.url)
    : undefined;

  if (agent) {
    // A SOCKS agent handles both protocols. `proxy: false` stops axios from
    // also applying its own env-var proxy handling on top of the agent.
    return { httpAgent: agent, httpsAgent: agent, proxy: false };
  }

  return {
    httpAgent: new HttpProxyAgent(proxy.url),
    httpsAgent: new HttpsProxyAgent(proxy.url),
    proxy: false,
  };
}

/** Playwright's launch/context proxy option shape, or undefined for direct. */
export function playwrightProxy(
  proxy: ProxyConfig | null
): { server: string; username?: string; password?: string } | undefined {
  if (!proxy) return undefined;
  const u = new URL(proxy.url);
  const username = u.username ? decodeURIComponent(u.username) : undefined;
  const password = u.password ? decodeURIComponent(u.password) : undefined;
  // Playwright wants credentials passed separately from the server URL.
  return {
    server: `${u.protocol}//${u.host}`,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  };
}
