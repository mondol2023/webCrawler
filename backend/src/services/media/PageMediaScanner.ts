/**
 * Generic "any site" media discovery.
 *
 * This is the fallback path for the ~everything that yt-dlp has no extractor
 * for. It loads the page in a real browser and finds media two ways at once:
 *
 *  1. **Network observation** — every response whose content-type or extension
 *     looks like media is recorded. This is the only way to catch players that
 *     build their source URL in JavaScript, which a static HTML parse misses
 *     entirely.
 *  2. **DOM + metadata parse** — `<video>`, `<audio>`, `<source>`, `<img>`, and
 *     og:/twitter: tags, read *after* scripts have run.
 *
 * The two sets are merged and de-duplicated by resolved URL.
 */
import type { BrowserContext, Page, Response } from 'playwright';
import { getBrowser } from '../crawler/PlaywrightCrawler';
import { installRequestGuard } from '../crawler/playwrightGuard';
import { logger } from '../../utils/logger';
import { playwrightProxy } from './proxyConfig';
import { detectFromStatus, detectFromText } from './RestrictionDetector';
import { NO_RESTRICTION, type MediaCandidate, type MediaKind, type ProxyConfig, type Restriction } from './types';

const NAV_TIMEOUT_MS = 30_000;
/** Time after load for lazy players to request their manifest. */
const SETTLE_MS = 2_500;
const MAX_CANDIDATES = 120;

const VIDEO_EXT_RE = /\.(mp4|webm|ogv|mov|m4v|mkv|avi|flv|m3u8|mpd)(\?|#|$)/i;
const AUDIO_EXT_RE = /\.(mp3|m4a|aac|wav|flac|opus|oga|ogg|weba)(\?|#|$)/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?|#|$)/i;

/** Manifest formats that need yt-dlp/ffmpeg to become a single playable file. */
const STREAMING_RE = /\.(m3u8|mpd)(\?|#|$)/i;

/** Tracking pixels and sprites we never want to offer as downloads. */
const JUNK_IMAGE_RE = /(sprite|pixel|spacer|blank|1x1|tracking|beacon|analytics)/i;

export interface ScanOutcome {
  pageTitle?: string;
  candidates: MediaCandidate[];
  restriction: Restriction;
  errorMessage?: string;
}

/** Raw media reference before it becomes a candidate. */
interface Hit {
  url: string;
  kind: MediaKind;
  source: MediaCandidate['source'];
  mimeType?: string;
  sizeBytes?: number;
  posterUrl?: string;
  label?: string;
  width?: number;
  height?: number;
}

function kindFromMime(mime: string | undefined, url: string): MediaKind | null {
  const m = (mime ?? '').toLowerCase();
  if (m.startsWith('video/') || m.includes('mpegurl') || m.includes('dash+xml')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('image/')) return 'image';

  if (VIDEO_EXT_RE.test(url)) return 'video';
  if (AUDIO_EXT_RE.test(url)) return 'audio';
  if (IMAGE_EXT_RE.test(url)) return 'image';
  return null;
}

function labelFor(hit: Hit, index: number): string {
  if (hit.label) return hit.label;
  if (hit.width && hit.height) return `${hit.width}x${hit.height}`;
  if (STREAMING_RE.test(hit.url)) return 'Adaptive stream (HLS/DASH)';

  try {
    const name = decodeURIComponent(new URL(hit.url).pathname.split('/').pop() ?? '');
    if (name && name.length <= 60) return name;
  } catch {
    /* fall through to the generic label */
  }
  return `${hit.kind} ${index + 1}`;
}

export class PageMediaScanner {
  /**
   * Loads `url` and returns every downloadable asset found. Never throws for
   * ordinary failures — a blocked or broken page comes back as a `restriction`
   * so the caller can show the user something useful.
   */
  async scan(url: string, proxy: ProxyConfig | null): Promise<ScanOutcome> {
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      const browser = await getBrowser();
      context = await browser.newContext({
        // A real UA — many CDNs reject the crawler UA outright for media.
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        ignoreHTTPSErrors: true,
        proxy: playwrightProxy(proxy),
      });

      page = await context.newPage();
      // With a proxy, requests resolve at the proxy (whose host was already
      // checked), so a local DNS verdict would be meaningless.
      if (!proxy) await installRequestGuard(page);
      const networkHits = new Map<string, Hit>();

      page.on('response', (response: Response) => {
        try {
          const rUrl = response.url();
          if (!rUrl.startsWith('http') || networkHits.has(rUrl)) return;

          const headers = response.headers();
          const mime = (headers['content-type'] ?? '').split(';')[0].trim();
          const kind = kindFromMime(mime, rUrl);
          if (!kind) return;
          if (kind === 'image' && JUNK_IMAGE_RE.test(rUrl)) return;

          const len = Number(headers['content-length']);
          networkHits.set(rUrl, {
            url: rUrl,
            kind,
            source: 'network',
            mimeType: mime || undefined,
            sizeBytes: Number.isFinite(len) && len > 0 ? len : undefined,
          });
        } catch {
          // A response handler must never break the scan.
        }
      });

      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });

      if (!response) {
        return {
          candidates: [],
          restriction: NO_RESTRICTION,
          errorMessage: 'The page did not respond.',
        };
      }

      const status = response.status();
      if (status >= 400) {
        const body = await page.content().catch(() => '');
        return { candidates: [], restriction: detectFromStatus(status, body) };
      }

      // Give lazy-loaded players a chance to request their sources.
      await page.waitForTimeout(SETTLE_MS);

      const pageTitle = await page.title().catch(() => undefined);
      const domHits = await this.readDom(page);
      const bodyText = await page
        .evaluate(() => document.body?.innerText?.slice(0, 20_000) ?? '')
        .catch(() => '');

      // Merge: DOM entries win on conflict because they carry posters and labels.
      const merged = new Map<string, Hit>();
      for (const hit of networkHits.values()) merged.set(hit.url, hit);
      for (const hit of domHits) merged.set(hit.url, { ...merged.get(hit.url), ...hit });

      const candidates = this.toCandidates([...merged.values()], url);

      // A page that rendered fine but yielded nothing is often a login wall;
      // surface that reason rather than an empty list with no explanation.
      const restriction =
        candidates.length === 0 ? detectFromText(bodyText) : NO_RESTRICTION;

      return { pageTitle, candidates, restriction };
    } catch (error) {
      const message = (error as Error).message;
      logger.debug(`Media scan failed for ${url}: ${message}`);
      const restriction = detectFromText(message);
      return {
        candidates: [],
        restriction,
        errorMessage:
          restriction.kind === 'none'
            ? /timeout/i.test(message)
              ? 'The page took too long to load (30s).'
              : 'Could not load this page in the browser.'
            : undefined,
      };
    } finally {
      await page?.close().catch(() => undefined);
      await context?.close().catch(() => undefined);
    }
  }

  /** Reads media out of the rendered DOM. Runs entirely inside the page. */
  private async readDom(page: Page): Promise<Hit[]> {
    const raw = await page.evaluate(() => {
      const abs = (u: string | null | undefined): string | null => {
        if (!u || u.startsWith('data:') || u.startsWith('blob:')) return null;
        try {
          return new URL(u, document.baseURI).toString();
        } catch {
          return null;
        }
      };

      const out: {
        url: string;
        kind: 'video' | 'audio' | 'image';
        source: 'dom' | 'meta';
        mimeType?: string;
        posterUrl?: string;
        label?: string;
        width?: number;
        height?: number;
      }[] = [];

      document.querySelectorAll('video').forEach((el) => {
        const poster = abs(el.getAttribute('poster')) ?? undefined;
        const label = el.getAttribute('title') || el.getAttribute('aria-label') || undefined;
        const push = (src: string | null, type?: string) => {
          const u = abs(src);
          if (u) {
            out.push({
              url: u,
              kind: 'video',
              source: 'dom',
              mimeType: type ?? undefined,
              posterUrl: poster,
              label,
              width: el.videoWidth || undefined,
              height: el.videoHeight || undefined,
            });
          }
        };
        push(el.getAttribute('src'));
        el.querySelectorAll('source').forEach((s) =>
          push(s.getAttribute('src'), s.getAttribute('type') ?? undefined)
        );
      });

      document.querySelectorAll('audio').forEach((el) => {
        const label = el.getAttribute('title') || el.getAttribute('aria-label') || undefined;
        const push = (src: string | null, type?: string) => {
          const u = abs(src);
          if (u) out.push({ url: u, kind: 'audio', source: 'dom', mimeType: type ?? undefined, label });
        };
        push(el.getAttribute('src'));
        el.querySelectorAll('source').forEach((s) =>
          push(s.getAttribute('src'), s.getAttribute('type') ?? undefined)
        );
      });

      document.querySelectorAll('img').forEach((el) => {
        // Prefer the highest-resolution srcset entry over the fallback src.
        const srcset = el.getAttribute('srcset');
        let best = el.getAttribute('src');
        if (srcset) {
          const parsed = srcset
            .split(',')
            .map((part) => part.trim().split(/\s+/))
            .map(([u, d]) => ({ u, w: parseInt(d ?? '0', 10) || 0 }))
            .sort((a, b) => b.w - a.w);
          if (parsed[0]?.u) best = parsed[0].u;
        }
        const u = abs(best);
        if (!u) return;
        out.push({
          url: u,
          kind: 'image',
          source: 'dom',
          label: el.getAttribute('alt') || undefined,
          width: el.naturalWidth || undefined,
          height: el.naturalHeight || undefined,
        });
      });

      const metaSelectors: [string, 'video' | 'image'][] = [
        ['meta[property="og:video:secure_url"]', 'video'],
        ['meta[property="og:video:url"]', 'video'],
        ['meta[property="og:video"]', 'video'],
        ['meta[name="twitter:player:stream"]', 'video'],
        ['meta[property="og:image"]', 'image'],
        ['meta[name="twitter:image"]', 'image'],
      ];
      for (const [selector, kind] of metaSelectors) {
        document.querySelectorAll(selector).forEach((el) => {
          const u = abs(el.getAttribute('content'));
          if (u) out.push({ url: u, kind, source: 'meta', label: `${kind} (page metadata)` });
        });
      }

      return out;
    });

    return raw as Hit[];
  }

  private toCandidates(hits: Hit[], pageUrl: string): MediaCandidate[] {
    // Tiny decorative images are noise; drop them once dimensions are known.
    const filtered = hits.filter((h) => {
      if (h.kind !== 'image') return true;
      if (JUNK_IMAGE_RE.test(h.url)) return false;
      if (h.width && h.height && h.width < 100 && h.height < 100) return false;
      return true;
    });

    const order: Record<MediaKind, number> = { video: 0, audio: 1, image: 2 };
    filtered.sort((a, b) => {
      if (a.kind !== b.kind) return order[a.kind] - order[b.kind];
      return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);
    });

    return filtered.slice(0, MAX_CANDIDATES).map((hit, i) => {
      const streaming = STREAMING_RE.test(hit.url);
      let container: string | undefined;
      try {
        container = new URL(hit.url).pathname.split('.').pop()?.slice(0, 5).toLowerCase();
      } catch {
        container = undefined;
      }

      return {
        id: `scan:${i}`,
        kind: hit.kind,
        source: hit.source,
        url: hit.url,
        pageUrl,
        label: labelFor(hit, i),
        quality: hit.width && hit.height ? `${hit.width}x${hit.height}` : undefined,
        container,
        mimeType: hit.mimeType,
        width: hit.width,
        height: hit.height,
        sizeBytes: hit.sizeBytes,
        approximateSize: false,
        posterUrl: hit.posterUrl,
        // HLS/DASH manifests are playlists, not files — yt-dlp must assemble them.
        needsMuxing: streaming,
      };
    });
  }
}
