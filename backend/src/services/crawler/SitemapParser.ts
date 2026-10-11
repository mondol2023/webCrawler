import axios from 'axios';
import * as cheerio from 'cheerio';
import { getBaseUrl, isSameDomain, isValidUrl, normalizeUrl } from '../../utils/urlUtils';
import { logger } from '../../utils/logger';
import { publicAgents } from '../media/netGuard';

const USER_AGENT =
  'Mozilla/5.0 (compatible; WIPBot/1.0; +https://webintelligence.io/bot)';
const SITEMAP_TIMEOUT = 10000;
const MAX_SITEMAP_INDEX_FOLLOW = 5; // cap child sitemaps to keep discovery bounded

/**
 * Best-effort sitemap discovery. Reads /sitemap.xml (and one level of sitemap
 * indexes) to seed the crawl frontier. Failures are non-fatal — the crawler
 * falls back to link-following from the start URL.
 */
export class SitemapService {
  async getUrls(startUrl: string, maxUrls: number): Promise<string[]> {
    let base: string;
    try {
      base = getBaseUrl(startUrl);
    } catch {
      return [];
    }

    const discovered = new Set<string>();
    await this.collect(`${base}/sitemap.xml`, startUrl, discovered, maxUrls, 0);

    return [...discovered].slice(0, maxUrls);
  }

  private async collect(
    sitemapUrl: string,
    startUrl: string,
    out: Set<string>,
    maxUrls: number,
    depth: number
  ): Promise<void> {
    if (out.size >= maxUrls || depth > 1) return;

    const xml = await this.fetch(sitemapUrl);
    if (!xml) return;

    const $ = cheerio.load(xml, { xmlMode: true });

    // A <sitemapindex> points to child sitemaps; a <urlset> lists pages.
    const isIndex = $('sitemapindex').length > 0;

    if (isIndex) {
      const childSitemaps: string[] = [];
      $('sitemap > loc').each((_i, el) => {
        const loc = $(el).text().trim();
        if (loc && isValidUrl(loc) && isSameDomain(loc, startUrl)) childSitemaps.push(loc);
      });

      for (const child of childSitemaps.slice(0, MAX_SITEMAP_INDEX_FOLLOW)) {
        if (out.size >= maxUrls) break;
        await this.collect(child, startUrl, out, maxUrls, depth + 1);
      }
      return;
    }

    $('url > loc').each((_i, el) => {
      if (out.size >= maxUrls) return;
      const loc = $(el).text().trim();
      // A sitemap may list any host; only the crawled site's own pages count.
      if (loc && isValidUrl(loc) && isSameDomain(loc, startUrl)) out.add(normalizeUrl(loc));
    });
  }

  private async fetch(url: string): Promise<string | null> {
    try {
      const response = await axios.get<string>(url, {
        ...publicAgents(),
        timeout: SITEMAP_TIMEOUT,
        responseType: 'text',
        maxRedirects: 3,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml,text/xml,*/*' },
        validateStatus: (status) => status < 400,
      });
      return typeof response.data === 'string' ? response.data : null;
    } catch (error) {
      logger.debug(`Sitemap fetch failed for ${url}: ${(error as Error).message}`);
      return null;
    }
  }
}
