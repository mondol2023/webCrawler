/**
 * Server-side request forgery guard.
 *
 * The crawl and media endpoints fetch whatever URL the user types, so without
 * this the API would happily proxy requests to `localhost`, cloud metadata
 * endpoints, or anything else on the host's private network.
 *
 * Two layers:
 *  - `assertPublicUrl` / `assertPublicProxyUrl` are pre-flight checks that give
 *    the user a readable error before any work is queued.
 *  - `publicAgents()` enforces the same rule at connect time, on every hop. Its
 *    `guardedLookup` vets each DNS answer (closing DNS rebinding) and its
 *    `createConnection` vets literal IPs, which `net.connect` never looks up.
 *    Redirects are covered because axios hands these agents to every hop.
 */
import dns, { promises as dnsPromises } from 'dns';
import http from 'http';
import https from 'https';
import { isIP } from 'net';
import type { Duplex } from 'stream';

export class BlockedHostError extends Error {
  readonly code = 'EBLOCKED';
}

/** Hostnames that are never resolved, regardless of what they point at. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
]);

function ipv4IsPrivate(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b, c] = parts;

  if (a === 0) return true; // "this" network
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking (198.18.0.0/15)
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function ipv6IsPrivate(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0]; // strip zone index
  if (addr === '::' || addr === '::1') return true;
  if (addr.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(addr)) return true; // unique local (fc00::/7)
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) — judge by the
  // embedded v4 address.
  const dotted = addr.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return ipv4IsPrivate(dotted[1]);
  // Same, in the hex form the WHATWG URL parser normalises to
  // (`[::ffff:127.0.0.1]` becomes `[::ffff:7f00:1]`).
  const hexMapped = addr.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return ipv4IsPrivate(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return ipv4IsPrivate(ip);
  if (version === 6) return ipv6IsPrivate(ip);
  return true; // unparseable — refuse
}

/**
 * Shared hostname rule behind `assertPublicUrl` and `assertPublicProxyUrl`.
 * Resolves DNS so a public name that maps to 127.0.0.1 is still caught.
 */
async function assertPublicHost(rawHostname: string): Promise<void> {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    throw new BlockedHostError('Requests to local addresses are not allowed.');
  }

  // A literal IP needs no lookup.
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new BlockedHostError('Requests to private or loopback addresses are not allowed.');
    }
    return;
  }

  let records: { address: string }[];
  try {
    records = await dnsPromises.lookup(hostname, { all: true });
  } catch {
    throw new BlockedHostError(`Could not resolve "${hostname}".`);
  }

  if (records.length === 0) {
    throw new BlockedHostError(`Could not resolve "${hostname}".`);
  }

  // Every resolved address must be public — one private answer is enough to
  // reach an internal service, so we refuse the whole host.
  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      throw new BlockedHostError(
        'That hostname resolves to a private address, so it cannot be probed.'
      );
    }
  }
}

/**
 * Rejects any URL that is not plain http(s) pointing at a publicly routable
 * host. A pre-flight check only — the connect-time guard is `publicAgents()`.
 *
 * @throws BlockedHostError
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedHostError('That is not a valid URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedHostError('Only http:// and https:// URLs can be probed.');
  }

  await assertPublicHost(url.hostname);
  return url;
}

/**
 * Checks a *user-supplied* proxy URL (any scheme: http, https, socks*). The
 * operator's `MEDIA_PROXY_URL` is trusted and never goes through here.
 *
 * @throws BlockedHostError
 */
export async function assertPublicProxyUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedHostError('That is not a valid proxy URL.');
  }
  await assertPublicHost(url.hostname);
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number
) => void;

/**
 * Drop-in `dns.lookup` that fails with a `BlockedHostError` (code `EBLOCKED`)
 * when any resolved address is private.
 */
export function guardedLookup(hostname: string, options: dns.LookupOptions, cb: LookupCallback): void {
  const host = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
    cb(new BlockedHostError('Requests to local addresses are not allowed.'), '');
    return;
  }

  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, '');
    if (addresses.length === 0) {
      return cb(new BlockedHostError(`Could not resolve "${hostname}".`), '');
    }
    if (addresses.some((a) => isPrivateAddress(a.address))) {
      return cb(new BlockedHostError(`"${hostname}" resolves to a private address.`), '');
    }
    if (options.all) return cb(null, addresses);
    return cb(null, addresses[0].address, addresses[0].family);
  });
}

/** Error for a literal-IP host that is private, or null when it may connect. */
function literalHostError(host: string | null | undefined): BlockedHostError | null {
  const bare = (host ?? '').replace(/^\[|\]$/g, '');
  if (isIP(bare) && isPrivateAddress(bare)) {
    return new BlockedHostError(`Requests to private address ${bare} are not allowed.`);
  }
  return null;
}

type ConnectCallback = (err: Error | null, socket: Duplex) => void;

// `createConnection` exists on both agents at runtime but is missing from the
// @types/node class declarations, so it is reached through this shape.
type ConnectingAgent = {
  createConnection(options: http.ClientRequestArgs, cb: ConnectCallback): Duplex | undefined;
};

class PublicHttpAgent extends http.Agent {
  createConnection(options: http.ClientRequestArgs, cb: ConnectCallback): Duplex | undefined {
    const blocked = literalHostError(options.host);
    if (blocked) {
      cb(blocked, undefined as unknown as Duplex);
      return undefined;
    }
    return (http.Agent.prototype as unknown as ConnectingAgent).createConnection.call(this, options, cb);
  }
}

class PublicHttpsAgent extends https.Agent {
  createConnection(options: http.ClientRequestArgs, cb: ConnectCallback): Duplex | undefined {
    const blocked = literalHostError(options.host);
    if (blocked) {
      cb(blocked, undefined as unknown as Duplex);
      return undefined;
    }
    return (https.Agent.prototype as unknown as ConnectingAgent).createConnection.call(this, options, cb);
  }
}

let agents: { httpAgent: http.Agent; httpsAgent: https.Agent } | null = null;

/**
 * Agents that only ever connect to public addresses. Spread into an axios
 * config (`{ ...publicAgents() }`) — axios passes them to every redirect hop.
 */
export function publicAgents(): { httpAgent: http.Agent; httpsAgent: https.Agent } {
  agents ??= {
    httpAgent: new PublicHttpAgent({ lookup: guardedLookup, keepAlive: true }),
    httpsAgent: new PublicHttpsAgent({ lookup: guardedLookup, keepAlive: true }),
  };
  return agents;
}
