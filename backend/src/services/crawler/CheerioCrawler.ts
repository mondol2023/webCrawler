import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import {
  normalizeUrl,
  isSameDomain,
  shouldSkipUrl,
  resolveUrl,
  isValidUrl,
} from '../../utils/urlUtils';
import { logger } from '../../utils/logger';
import { publicAgents } from '../media/netGuard';

/** Shared shape returned by every page-fetching strategy (Cheerio / Playwright). */
export interface CrawlPageResult {
  url: string;
  html: string;
  statusCode: number;
  contentLength: number;
  discoveredLinks: string[];
}

const USER_AGENT =
  'Mozilla/5.0 (compatible; WIPBot/1.0; +https://webintelligence.io/bot)';
const REQUEST_TIMEOUT = 15000;
const MAX_CONTENT_LENGTH = 5 * 1024 * 1024; // 5MB safety cap

/**
 * Fast, lightweight crawler for server-rendered HTML using plain HTTP + Cheerio.
 * The orchestrator tries this first and only falls back to Playwright when a page
 * fails or requires JS rendering.
 */
export class CheerioCrawler {
  async fetchPage(url: string): Promise<CrawlPageResult | null> {
    try {
      const response = await axios.get<string>(url, {
        ...publicAgents(),
        timeout: REQUEST_TIMEOUT,
        maxContentLength: MAX_CONTENT_LENGTH,
        maxRedirects: 5,
        responseType: 'text',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        // Let the orchestrator decide what to do with 4xx/5xx statuses.
        validateStatus: () => true,
      });

      const contentType = String(response.headers['content-type'] ?? '');
      // Only parse HTML documents; skip binary/other content types.
      if (response.status < 400 && !contentType.includes('html')) {
        return null;
      }

      const html = typeof response.data === 'string' ? response.data : '';

      return {
        url,
        html,
        statusCode: response.status,
        contentLength: html.length,
        discoveredLinks: this.extractLinks(html, url),
      };
    } catch (error) {
      const message =
        error instanceof AxiosError ? error.message : (error as Error).message;
      logger.debug(`Cheerio fetch failed for ${url}: ${message}`);
      return null;
    }
  }

  private extractLinks(html: string, baseUrl: string): string[] {
    const $ = cheerio.load(html);
    const links = new Set<string>();

    $('a[href]').each((_i, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      if (
        href.startsWith('#') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('javascript:')
      ) {
        return;
      }

      const resolved = resolveUrl(baseUrl, href);
      if (!resolved) return;
      if (!isValidUrl(resolved)) return;
      if (!isSameDomain(resolved, baseUrl)) return;
      if (shouldSkipUrl(resolved)) return;

      links.add(normalizeUrl(resolved));
    });

    return [...links];
  }
}
