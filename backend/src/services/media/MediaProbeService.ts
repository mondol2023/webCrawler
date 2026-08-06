/**
 * Decides *how* to inspect a URL and merges the results.
 *
 * Strategy:
 *   - yt-dlp first. It has real extractors, so when it recognises the site it
 *     returns exact renditions (1080p / 720p / audio-only) rather than whatever
 *     URLs happen to be in the DOM.
 *   - The generic browser scanner runs when yt-dlp is unavailable, does not
 *     support the site, or found nothing.
 *   - When both produce results we keep both, labelled by source, because
 *     yt-dlp occasionally misses the plain `<video>` file sitting on the page.
 *
 * Restrictions are reported, never worked around. See RestrictionDetector.
 */
import { PageMediaScanner } from './PageMediaScanner';
import * as ytdlp from './YtDlpAdapter';
import { RobotsTxtService } from '../crawler/RobotsTxtParser';
import { assertPublicUrl, BlockedHostError } from './netGuard';
import { robotsRestriction } from './RestrictionDetector';
import { logger } from '../../utils/logger';
import { NO_RESTRICTION, type MediaCandidate, type ProbeOutcome, type ProxyConfig } from './types';

export interface ProbeRequest {
  url: string;
  proxy: ProxyConfig | null;
  /** When true (default), a robots.txt disallow aborts the probe. */
  respectRobotsTxt: boolean;
}

export class MediaProbeService {
  private scanner = new PageMediaScanner();
  private robots = new RobotsTxtService();

  async probe(req: ProbeRequest): Promise<ProbeOutcome> {
    const started = Date.now();
    const warnings: string[] = [];

    // Refuse internal/private targets before any network call.
    try {
      await assertPublicUrl(req.url);
    } catch (err) {
      if (err instanceof BlockedHostError) {
        return this.blocked(req, started, {
          kind: 'forbidden',
          message: err.message,
          proxyMayHelp: false,
        });
      }
      throw err;
    }

    if (req.respectRobotsTxt) {
      const allowed = await this.robots.isAllowed(req.url).catch(() => true);
      if (!allowed) {
        return this.blocked(req, started, robotsRestriction());
      }
    }

    // ─── 1. yt-dlp ──────────────────────────────────────────────────────────
    const ytResult = await ytdlp.probe(req.url, req.proxy);

    // A recognised restriction from yt-dlp is authoritative — it read the
    // site's own error message. Stop and report it.
    if (!ytResult.ok && ytResult.restriction.kind !== 'none') {
      return this.blocked(req, started, ytResult.restriction, 'ytdlp');
    }

    if (!ytResult.ok && ytResult.errorMessage) {
      warnings.push(ytResult.errorMessage);
    }

    const ytCandidates = ytResult.ok ? ytResult.candidates : [];

    // ─── 2. Generic scanner ─────────────────────────────────────────────────
    // Always run it for images (yt-dlp never returns those), and as the primary
    // source when yt-dlp came back empty.
    const scan = await this.scanner.scan(req.url, req.proxy);

    if (scan.errorMessage) warnings.push(scan.errorMessage);

    // Only let the scanner's restriction decide the outcome if yt-dlp also
    // found nothing — otherwise we'd hide perfectly good results.
    if (ytCandidates.length === 0 && scan.candidates.length === 0) {
      const restriction =
        scan.restriction.kind !== 'none' ? scan.restriction : NO_RESTRICTION;
      return {
        pageUrl: req.url,
        pageTitle: scan.pageTitle ?? ytResult.title,
        strategy: 'scanner',
        candidates: [],
        restriction,
        warnings,
        usedProxy: req.proxy !== null,
        durationMs: Date.now() - started,
      };
    }

    const candidates = this.merge(ytCandidates, scan.candidates);

    const strategy: ProbeOutcome['strategy'] =
      ytCandidates.length && scan.candidates.length
        ? 'hybrid'
        : ytCandidates.length
          ? 'ytdlp'
          : 'scanner';

    logger.info(
      `Media probe (${strategy}) found ${candidates.length} asset(s) at ${req.url}` +
        (req.proxy ? ` via ${req.proxy.safeLabel}` : '')
    );

    return {
      pageUrl: req.url,
      pageTitle: ytResult.title ?? scan.pageTitle,
      strategy,
      candidates,
      restriction: NO_RESTRICTION,
      warnings,
      usedProxy: req.proxy !== null,
      durationMs: Date.now() - started,
    };
  }

  /**
   * Combines both sources, dropping scanner hits that duplicate a yt-dlp
   * rendition, and re-issues ids so they are unique across the merged list.
   */
  private merge(fromYtdlp: MediaCandidate[], fromScan: MediaCandidate[]): MediaCandidate[] {
    const seen = new Set(fromYtdlp.map((c) => c.url));

    // yt-dlp renditions all share the page URL, so a scanner hit on that same
    // URL is the same thing described worse — drop it.
    const scanUnique = fromScan.filter((c) => !seen.has(c.url));

    const combined = [...fromYtdlp, ...scanUnique];
    return combined.map((c, i) => ({ ...c, id: `${c.id}#${i}` }));
  }

  private blocked(
    req: ProbeRequest,
    started: number,
    restriction: ProbeOutcome['restriction'],
    strategy: ProbeOutcome['strategy'] = 'scanner'
  ): ProbeOutcome {
    return {
      pageUrl: req.url,
      strategy,
      candidates: [],
      restriction,
      warnings: [],
      usedProxy: req.proxy !== null,
      durationMs: Date.now() - started,
    };
  }
}
