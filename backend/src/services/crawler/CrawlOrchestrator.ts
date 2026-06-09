import { CheerioCrawler } from './CheerioCrawler';
import { PlaywrightCrawler } from './PlaywrightCrawler';
import { RobotsTxtService } from './RobotsTxtParser';
import { SitemapService } from './SitemapParser';
import { ContentAnalyzer } from './ContentAnalyzer';
import { CrawlResult } from '../../models/CrawlResult.model';
import { CrawlJob } from '../../models/CrawlJob.model';
import { normalizeUrl, shouldSkipUrl } from '../../utils/urlUtils';
import { logger } from '../../utils/logger';
import { io } from '../../app';
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
}

export class CrawlOrchestrator {
  private cheerioCrawler = new CheerioCrawler();
  private playwrightCrawler = new PlaywrightCrawler();
  private robotsService = new RobotsTxtService();
  private sitemapService = new SitemapService();
  private analyzer = new ContentAnalyzer();

  async run(options: CrawlOptions): Promise<void> {
    const {
      jobId,
      userId,
      url,
      keywords,
      phrases,
      maxDepth,
      maxPages,
      respectRobotsTxt,
    } = options;

    const visited = new Set<string>();
    const queue: Array<{ url: string; depth: number }> = [
      { url: normalizeUrl(url), depth: 0 },
    ];

    let pagesCrawled = 0;
    let pagesMatched = 0;

    // Discover URLs from sitemap first
    logger.info(`[Job ${jobId}] Starting crawl: ${url}`);
    const sitemapUrls = await this.sitemapService.getUrls(url, maxPages);
    if (sitemapUrls.length > 0) {
      logger.info(`[Job ${jobId}] Sitemap: found ${sitemapUrls.length} URLs`);
      sitemapUrls.forEach((u) => queue.push({ url: u, depth: 1 }));
    }

    const pagesDiscovered = queue.length;
    await this.updateJobProgress(jobId, 0, pagesDiscovered, 0, 0);

    while (queue.length > 0 && pagesCrawled < maxPages) {
      const current = queue.shift()!;
      const normalized = normalizeUrl(current.url);

      if (visited.has(normalized)) continue;
      if (shouldSkipUrl(normalized)) continue;
      if (current.depth > maxDepth) continue;

      // Robots.txt check
      if (respectRobotsTxt) {
        const allowed = await this.robotsService.isAllowed(normalized);
        if (!allowed) {
          logger.debug(`[Job ${jobId}] Blocked by robots.txt: ${normalized}`);
          continue;
        }
      }

      visited.add(normalized);

      // Fetch page — try Cheerio first, fallback to Playwright
      let result = await this.cheerioCrawler.fetchPage(normalized);
      let usedPlaywright = false;

      if (!result || result.statusCode >= 400) {
        logger.debug(`[Job ${jobId}] Cheerio failed, trying Playwright: ${normalized}`);
        result = await this.playwrightCrawler.fetchPage(normalized);
        usedPlaywright = true;
      }

      if (!result) {
        logger.debug(`[Job ${jobId}] Both crawlers failed: ${normalized}`);
        continue;
      }

      pagesCrawled++;

      // Analyze content
      const analysis = this.analyzer.analyze(
        result.html,
        normalized,
        keywords,
        phrases
      );

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
      }

      // Enqueue discovered links
      if (current.depth < maxDepth) {
        for (const link of result.discoveredLinks) {
          if (!visited.has(normalizeUrl(link))) {
            queue.push({ url: link, depth: current.depth + 1 });
          }
        }
      }

      // Progress update every 5 pages
      if (pagesCrawled % 5 === 0) {
        const progress = Math.floor((pagesCrawled / maxPages) * 100);
        await this.updateJobProgress(
          jobId,
          progress,
          queue.length + pagesCrawled,
          pagesCrawled,
          pagesMatched
        );

        // Emit socket progress
        io.to(`job:${jobId}`).emit('job:progress', {
          jobId,
          progress,
          pagesCrawled,
          pagesMatched,
          pagesDiscovered: queue.length + pagesCrawled,
        });
      }

      // Crawl delay to be polite
      const delay = await this.robotsService.getCrawlDelay(normalized);
      const actualDelay = usedPlaywright ? Math.max(delay, 2000) : Math.max(delay, 500);
      await this.sleep(actualDelay);
    }

    // Final update
    await this.updateJobProgress(jobId, 100, visited.size, pagesCrawled, pagesMatched);
    await this.playwrightCrawler.close();

    logger.info(
      `[Job ${jobId}] Crawl complete. Pages: ${pagesCrawled}, Matched: ${pagesMatched}`
    );
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}