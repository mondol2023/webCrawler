import { CheerioCrawler } from './CheerioCrawler';
import { PlaywrightCrawler } from './PlaywrightCrawler';
import { RobotsTxtService } from './RobotsTxtParser';
import { SitemapService } from './SitemapParser';
import { ContentAnalyzer, THIN_CONTENT_CHARS } from './ContentAnalyzer';
import { CrawlResult } from '../../models/CrawlResult.model';
import { CrawlJob } from '../../models/CrawlJob.model';
import { Frontier } from './Frontier';
import { logger } from '../../utils/logger';
import { emitToJob } from '../socketService';
import mongoose from 'mongoose';

export interface CrawlOptions {
  jobId: string;
  userId: string;
  url: string;
  keywords: string[];
  phrases: string[];
  maxDepth: number;
  maxPages: number;
  respectRobotsTxt: boolean;
  /** Aborted by the worker when the user cancels a running crawl. */
  signal?: AbortSignal;
}

export interface CrawlOutcome {
  /** True when the crawl stopped early because of an abort; saved results are kept. */
  cancelled: boolean;
}

/** Minimum gap between progress writes/events, however fast pages come in. */
const PROGRESS_INTERVAL_MS = 1000;

export class CrawlOrchestrator {
  private cheerioCrawler = new CheerioCrawler();
  private playwrightCrawler = new PlaywrightCrawler();
  private robotsService = new RobotsTxtService();
  private sitemapService = new SitemapService();
  private analyzer = new ContentAnalyzer();

  async run(options: CrawlOptions): Promise<CrawlOutcome> {
    const {
      jobId,
      userId,
      url,
      keywords,
      phrases,
      maxDepth,
      maxPages,
      respectRobotsTxt,
      signal,
    } = options;

    try {
      const frontier = new Frontier(maxDepth);
      frontier.push(url, 0);

      let pagesCrawled = 0;
      let pagesMatched = 0;
      let lastProgressAt = 0;

      // The single most-weighted page seen so far. We hold onto its raw HTML
      // (one page at a time) so we can build the cached snapshot after the crawl
      // without an extra round-trip. Strictly-greater comparison keeps the
      // earliest page on ties (e.g. score 0 when no keywords were provided).
      let best: { url: string; score: number; html: string } | null = null;

      // Discover URLs from sitemap first
      logger.info(`[Job ${jobId}] Starting crawl: ${url}`);
      const sitemapUrls = await this.sitemapService.getUrls(url, maxPages);
      if (sitemapUrls.length > 0) {
        logger.info(`[Job ${jobId}] Sitemap: found ${sitemapUrls.length} URLs`);
        sitemapUrls.forEach((u) => frontier.push(u, 1));
      }

      await this.updateJobProgress(jobId, 0, frontier.discovered, 0, 0);

      while (frontier.pending > 0 && pagesCrawled < maxPages) {
        if (signal?.aborted) break;

        // Entries were deduped, depth-checked and skip-filtered at enqueue.
        const current = frontier.shift()!;
        const normalized = current.url;

        // Robots.txt check
        if (respectRobotsTxt) {
          const allowed = await this.robotsService.isAllowed(normalized);
          if (!allowed) {
            logger.debug(`[Job ${jobId}] Blocked by robots.txt: ${normalized}`);
            continue;
          }
        }

        if (signal?.aborted) break;

        // Fetch page — try Cheerio first, fallback to Playwright
        let result = await this.cheerioCrawler.fetchPage(normalized, signal);
        let usedPlaywright = false;

        // A fetch that failed because we aborted it is not a reason to try again.
        if (signal?.aborted) break;

        if (!result || result.statusCode >= 400) {
          logger.debug(`[Job ${jobId}] Cheerio failed, trying Playwright: ${normalized}`);
          result = await this.playwrightCrawler.fetchPage(normalized, signal);
          usedPlaywright = true;
          if (signal?.aborted) break;
        }

        if (!result) {
          logger.debug(`[Job ${jobId}] Both crawlers failed: ${normalized}`);
          continue;
        }

        pagesCrawled++;

        // Analyze content
        let analysis = this.analyzer.analyze(
          result.html,
          normalized,
          keywords,
          phrases
        );

        // A 200 OK carrying almost no text is the signature of a client-rendered
        // page — Cheerio received the empty SPA shell and cannot run its JS, so
        // the status-code check above never triggered the fallback. Re-fetch
        // through Playwright and keep whichever render yielded more text.
        if (!usedPlaywright && !signal?.aborted && analysis.contentLength < THIN_CONTENT_CHARS) {
          logger.debug(
            `[Job ${jobId}] Thin content (${analysis.contentLength} chars), re-rendering with Playwright: ${normalized}`
          );
          const rendered = await this.playwrightCrawler.fetchPage(normalized, signal);
          if (rendered) {
            usedPlaywright = true;
            const renderedAnalysis = this.analyzer.analyze(
              rendered.html,
              normalized,
              keywords,
              phrases
            );
            if (renderedAnalysis.contentLength > analysis.contentLength) {
              result = rendered;
              analysis = renderedAnalysis;
            }
          }
        }

        if (analysis.relevanceScore > 0 || keywords.length === 0) {
          // Save result to DB
          await CrawlResult.findOneAndUpdate(
            { jobId: new mongoose.Types.ObjectId(jobId), url: normalized },
            {
              jobId: new mongoose.Types.ObjectId(jobId),
              userId: new mongoose.Types.ObjectId(userId),
              url: normalized,
              title: analysis.title,
              statusCode: result.statusCode,
              contentLength: analysis.contentLength,
              crawledAt: new Date(),
              relevanceScore: analysis.relevanceScore,
              matchedKeywords: analysis.matchedKeywords,
              matchedPhrases: analysis.matchedPhrases,
              extracted: analysis.extracted,
              rawTextSnippet: analysis.rawTextSnippet,
              depth: current.depth,
            },
            { upsert: true, new: true }
          );

          if (analysis.relevanceScore > 0) pagesMatched++;

          if (best === null || analysis.relevanceScore > best.score) {
            best = { url: normalized, score: analysis.relevanceScore, html: result.html };
          }
        }

        // Enqueue discovered links; the frontier drops dupes and too-deep links.
        for (const link of result.discoveredLinks) {
          frontier.push(link, current.depth + 1);
        }

        // Progress at most once a second, however fast pages arrive.
        const now = Date.now();
        if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
          lastProgressAt = now;
          const progress = Math.floor((pagesCrawled / maxPages) * 100);
          await this.updateJobProgress(
            jobId,
            progress,
            frontier.discovered,
            pagesCrawled,
            pagesMatched
          );

          // Emit socket progress
          emitToJob(jobId, 'job:progress', {
            jobId,
            progress,
            pagesCrawled,
            pagesMatched,
            pagesDiscovered: frontier.discovered,
          });
        }

        // Crawl delay to be polite
        const delay = await this.robotsService.getCrawlDelay(normalized);
        const actualDelay = usedPlaywright ? Math.max(delay, 2000) : Math.max(delay, 500);
        await this.sleep(actualDelay, signal);
      }

      const cancelled = signal?.aborted === true;

      // Cache a size-bounded snapshot of the most-weighted page and flag it as
      // the primary result. Re-runs clear any previous primary first.
      if (best !== null) {
        const cache = this.analyzer.buildCache(best.html, best.url);
        await CrawlResult.updateMany(
          { jobId: new mongoose.Types.ObjectId(jobId), isPrimary: true },
          { $set: { isPrimary: false } }
        );
        await CrawlResult.findOneAndUpdate(
          { jobId: new mongoose.Types.ObjectId(jobId), url: best.url },
          { $set: { isPrimary: true, cache } }
        );
        logger.info(
          `[Job ${jobId}] Primary result cached (${best.score} pts, ${cache.sizeBytes} bytes${cache.truncated ? ', truncated' : ''}): ${best.url}`
        );
      }

      // Final update. A cancelled crawl keeps its real progress instead of 100%.
      const finalProgress = cancelled ? Math.floor((pagesCrawled / maxPages) * 100) : 100;
      await this.updateJobProgress(
        jobId,
        finalProgress,
        frontier.discovered,
        pagesCrawled,
        pagesMatched
      );

      logger.info(
        `[Job ${jobId}] Crawl ${cancelled ? 'cancelled' : 'complete'}. Pages: ${pagesCrawled}, Matched: ${pagesMatched}`
      );
      return { cancelled };
    } finally {
      // Always release the browser context, even when the crawl throws.
      await this.playwrightCrawler.close();
    }
  }

  private async updateJobProgress(
    jobId: string,
    progress: number,
    pagesDiscovered: number,
    pagesCrawled: number,
    pagesMatched: number
  ): Promise<void> {
    await CrawlJob.findByIdAndUpdate(jobId, {
      progress,
      pagesDiscovered,
      pagesCrawled,
      pagesMatched,
    });
  }

  /** Resolves after `ms`, or immediately when the signal aborts. */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal?.addEventListener('abort', done, { once: true });
    });
  }
}