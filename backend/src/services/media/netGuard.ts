/**
 * Server-side request forgery guard.
 *
 * The media endpoints fetch whatever URL the user types, so without this the
 * API would happily proxy requests to `localhost`, cloud metadata endpoints, or
 * anything else on the host's private network. Every outbound media fetch
 * resolves its hostname through here first.
 */
import { promises as dns } from 'dns';
import { isIP } from 'net';

export class BlockedHostError extends Error {}

/** Hostnames that are never resolved, regardless of what they point at. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
]);

function ipv4IsPrivate(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;

  if (a === 0) return true; // "this" network
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function ipv6IsPrivate(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0]; // strip zone index
  if (addr === '::' || addr === '::1') return true;
  if (addr.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(addr)) return true; // unique local (fc00::/7)
  // IPv4-mapped (::ffff:a.b.c.d) — judge by the embedded v4 address.
  const mapped = addr.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4IsPrivate(mapped[1]);
  return false;
}

function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return ipv4IsPrivate(ip);
  if (version === 6) return ipv6IsPrivate(ip);
  return true; // unparseable — refuse
}

/**
 * Rejects any URL that is not plain http(s) pointing at a publicly routable
 * host. Resolves DNS so a public name that maps to 127.0.0.1 is still caught.
 *
 * Note: this is a pre-flight check, so a determined attacker could still win a
 * DNS-rebinding race. It closes the realistic hole (typing an internal URL into
 * the form) without pretending to be airtight.
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

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    throw new BlockedHostError('Requests to local addresses are not allowed.');
  }

  // A literal IP needs no lookup.
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new BlockedHostError('Requests to private or loopback addresses are not allowed.');
    }
    return url;
  }

  let records: { address: string }[];
  try {
    records = await dns.lookup(hostname, { all: true });
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

  return url;
}
