/**
 * Shared vocabulary for the media downloader.
 *
 * Kept in its own module (with no imports beyond the DB models) so every other
 * file in `services/media` can be read in isolation when debugging — the type
 * names are the contract between the scanner, the probe, and the downloader.
 */

/** What kind of asset a candidate is. */
export type MediaKind = 'video' | 'audio' | 'image';

/** How a candidate was discovered — useful when a probe returns something odd. */
export type MediaSource =
  | 'ytdlp' // reported by yt-dlp's extractor
  | 'dom' // parsed from <video>/<audio>/<img>/<source> tags
  | 'network' // observed as a media response while the page loaded
  | 'meta'; // og:video / og:image / twitter:player metadata

/**
 * Why a page or asset cannot be downloaded. `none` means no restriction was
 * detected. Everything else is surfaced to the user verbatim — we never try to
 * defeat these, we only explain them.
 */
export type RestrictionKind =
  | 'none'
  | 'geo' // blocked in the server's country
  | 'login' // requires an authenticated session
  | 'paywall' // requires a paid subscription
  | 'drm' // encrypted / protected stream
  | 'robots' // site's robots.txt disallows automated access
  | 'forbidden' // 403 with no more specific signal
  | 'rate_limited'
  | 'unavailable'; // removed, private, or region-locked at the source

export interface Restriction {
  kind: RestrictionKind;
  /** Plain-language explanation shown directly in the UI. */
  message: string;
  /**
   * True only for restrictions that are purely a function of where the request
   * originates (i.e. `geo`). Drives whether the UI offers to retry through the
   * user's proxy. Never set for DRM, login, or paywall restrictions.
   */
  proxyMayHelp: boolean;
}

/** A single downloadable asset offered to the user. */
export interface MediaCandidate {
  /** Stable id within a probe — what the client sends back to request a download. */
  id: string;
  kind: MediaKind;
  source: MediaSource;
  /** Direct media URL, or the page URL when yt-dlp will resolve it at download time. */
  url: string;
  /** Page the asset was found on. */
  pageUrl: string;
  label: string;
  /** e.g. "1920x1080", "128kbps" — free-form, display only. */
  quality?: string;
  container?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  /** Byte size when known or reliably estimated; undefined for live/HLS. */
  sizeBytes?: number;
  approximateSize: boolean;
  posterUrl?: string;
  /**
   * yt-dlp format id. Present only for `source: 'ytdlp'` candidates — the
   * downloader passes it back with `-f` so the user gets the exact rendition
   * they picked.
   */
  formatId?: string;
  /** True when the stream is HLS/DASH and must be muxed by yt-dlp/ffmpeg. */
  needsMuxing: boolean;
  /** Set when this specific rendition is unavailable even though the page is not. */
  restriction?: Restriction;
}

/** Result of probing a page for downloadable media. */
export interface ProbeOutcome {
  pageUrl: string;
  pageTitle?: string;
  /** Which strategy produced the candidates. */
  strategy: 'ytdlp' | 'scanner' | 'hybrid';
  candidates: MediaCandidate[];
  /** Page-level restriction. `kind: 'none'` when the page probed cleanly. */
  restriction: Restriction;
  /** Non-fatal problems worth showing (e.g. "yt-dlp not installed"). */
  warnings: string[];
  /** True when the request was routed through a proxy. */
  usedProxy: boolean;
  durationMs: number;
}

/** Validated proxy the user supplied for a single request. */
export interface ProxyConfig {
  /** Full proxy URL including scheme, e.g. `socks5://host:1080`. */
  url: string;
  /** Same URL with any credentials masked — the only form that may be logged. */
  safeLabel: string;
}

export const NO_RESTRICTION: Restriction = {
  kind: 'none',
  message: '',
  proxyMayHelp: false,
};
