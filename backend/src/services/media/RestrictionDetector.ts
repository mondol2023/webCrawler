/**
 * Classifies *why* a page or asset refused to hand over its media.
 *
 * This module deliberately only ever produces an explanation. It contains no
 * circumvention logic: DRM, login walls, and paywalls are reported to the user
 * as blocked and the pipeline stops there. The single restriction we mark as
 * retryable is `geo`, and the only remedy offered is the user's own proxy.
 */
import type { Restriction, RestrictionKind } from './types';
import { NO_RESTRICTION } from './types';

interface Rule {
  kind: RestrictionKind;
  /** Matched case-insensitively against yt-dlp stderr or page text. */
  patterns: RegExp[];
  message: string;
  proxyMayHelp: boolean;
}

/**
 * Ordered most-specific first. DRM and login checks must precede the generic
 * `forbidden` fallback so a 403 on a DRM stream is labelled accurately.
 */
const RULES: Rule[] = [
  {
    kind: 'drm',
    patterns: [
      /\bdrm\b/i,
      /widevine/i,
      /playready/i,
      /fairplay/i,
      /encrypted (?:media|stream)/i,
      /protected content/i,
      /#EXT-X-KEY(?!:METHOD=NONE)/i,
    ],
    message:
      'This content is DRM-protected. It cannot be downloaded — the stream is encrypted and the licence is tied to an authorised player.',
    proxyMayHelp: false,
  },
  {
    kind: 'paywall',
    patterns: [
      /subscription (?:is )?required/i,
      /subscribers only/i,
      /premium (?:members|content|only)/i,
      /purchase (?:this|to watch)/i,
      /rent or buy/i,
    ],
    message:
      'This content sits behind a paid subscription. Downloading it would require bypassing the paywall, which this tool does not do.',
    proxyMayHelp: false,
  },
  {
    kind: 'login',
    patterns: [
      /sign in to (?:confirm|watch|continue|view)/i,
      /log ?in required/i,
      /requires? (?:an? )?(?:account|authentication)/i,
      /private video/i,
      /members[- ]only/i,
      /cookies are required/i,
      /confirm you'?re not a bot/i,
    ],
    message:
      'The site requires a signed-in session to reach this media. This tool does not authenticate on your behalf or reuse someone else’s session.',
    proxyMayHelp: false,
  },
  {
    kind: 'geo',
    patterns: [
      /not available in your country/i,
      /geo[- ]?(?:restricted|blocked|blocking)/i,
      /unavailable in your (?:region|location|country)/i,
      /blocked it in your country/i,
      /this video is not available from your location/i,
      /content is unavailable in your region/i,
    ],
    message:
      'This content is blocked in the server’s country. If you have your own proxy or VPN endpoint in a permitted region, you can retry the probe through it.',
    proxyMayHelp: true,
  },
  {
    kind: 'rate_limited',
    patterns: [/too many requests/i, /rate[- ]?limit/i, /HTTP Error 429/i],
    message:
      'The site is rate-limiting this server. Wait a few minutes before retrying.',
    proxyMayHelp: false,
  },
  {
    kind: 'unavailable',
    patterns: [
      /video (?:is )?unavailable/i,
      /has been removed/i,
      /no longer available/i,
      /this video does not exist/i,
      /account (?:was )?terminated/i,
    ],
    message: 'The source reports this content as removed or unavailable.',
    proxyMayHelp: false,
  },
];

/** Scans arbitrary text (yt-dlp stderr, page HTML, error messages) for a known restriction. */
export function detectFromText(text: string | undefined | null): Restriction {
  if (!text) return NO_RESTRICTION;
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      return { kind: rule.kind, message: rule.message, proxyMayHelp: rule.proxyMayHelp };
    }
  }
  return NO_RESTRICTION;
}

/**
 * Classifies an HTTP status, consulting the body first so a 403 that says
 * "not available in your country" is reported as `geo`, not bare `forbidden`.
 */
export function detectFromStatus(status: number, body?: string): Restriction {
  const fromBody = detectFromText(body);
  if (fromBody.kind !== 'none') return fromBody;

  if (status === 401) {
    return {
      kind: 'login',
      message:
        'The site returned 401 Unauthorized — this media requires a signed-in session.',
      proxyMayHelp: false,
    };
  }
  if (status === 402) {
    return {
      kind: 'paywall',
      message: 'The site returned 402 Payment Required — this content must be purchased.',
      proxyMayHelp: false,
    };
  }
  if (status === 429) {
    return {
      kind: 'rate_limited',
      message: 'The site is rate-limiting this server (429). Try again in a few minutes.',
      proxyMayHelp: false,
    };
  }
  if (status === 451) {
    return {
      kind: 'geo',
      message:
        'The site returned 451 Unavailable For Legal Reasons — this is region-blocked. Retrying through your own proxy in a permitted region may work.',
      proxyMayHelp: true,
    };
  }
  if (status === 403) {
    return {
      kind: 'forbidden',
      message:
        'The site refused the request (403). It may be blocking automated clients, or the media may require a session this tool does not have.',
      proxyMayHelp: false,
    };
  }
  if (status >= 400) {
    return {
      kind: 'unavailable',
      message: `The site returned HTTP ${status} for this URL.`,
      proxyMayHelp: false,
    };
  }
  return NO_RESTRICTION;
}

/** Restriction used when robots.txt disallows the URL. */
export function robotsRestriction(): Restriction {
  return {
    kind: 'robots',
    message:
      'This site’s robots.txt asks automated clients not to fetch this URL. Probing was skipped to respect that.',
    proxyMayHelp: false,
  };
}

/** True when the restriction should stop a download attempt outright. */
export function isBlocking(restriction: Restriction): boolean {
  return restriction.kind !== 'none';
}
