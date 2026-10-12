import { Browser, BrowserContext, chromium } from 'playwright';
import {
  normalizeUrl,
  isSameDomain,
  shouldSkipUrl,
  resolveUrl,
  isValidUrl,
} from '../../utils/urlUtils';
import { logger } from '../../utils/logger';
import { CrawlPageResult } from './CheerioCrawler';
import { installRequestGuard } from './playwrightGuard';

let browserInstance: Browser | null = null;
let launching: Promise<Browser> | null = null;

/**
 * Shared, lazily-launched Chromium instance. Exported so other subsystems (the
 * media scanner) reuse this single process instead of launching their own —
 * `closeBrowser()` on shutdown then covers all of them.
 */
export async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) return browserInstance;
  // Single-flight: concurrent callers share one launch instead of each
  // starting (and leaking) its own Chromium process.
  if (!launching) {
    launching = (async () => {
      try {
        const browser = await chromium.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
          ],
        });
        browserInstance = browser;
        logger.info('Playwright browser launched');
        return browser;
      } finally {
        launching = null;
      }
    })();
  }
  return launching;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

export class PlaywrightCrawler {
  private context: BrowserContext | null = null;

  async init(): Promise<void> {
    const browser = await getBrowser();
    this.context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (compatible; WIPBot/1.0; +https://webintelligence.io/bot)',
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
    });
  }

  async fetchPage(url: string, signal?: AbortSignal): Promise<CrawlPageResult | null> {
    if (signal?.aborted) return null;
    if (!this.context) await this.init();

    const page = await this.context!.newPage();
    // Closing the page makes any in-flight goto/content call reject at once,
    // which is what lets a cancel interrupt a slow render.
    const abortPage = () => void page.close().catch(() => undefined);
    signal?.addEventListener('abort', abortPage, { once: true });

    try {
      // SSRF guard first: routes run in reverse registration order, so the
      // type-blocker below aborts media early and everything else falls
      // through to this guard.
      await installRequestGuard(page);

      // Block unnecessary resources to speed up crawl
      await page.route('**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,mp4,mp3}', (route) =>
        route.abort()
      );

      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      if (!response) return null;

      const statusCode = response.status();
      if (statusCode >= 400) {
        return null;
      }

      // Wait a bit for JS rendering
      await page.waitForTimeout(1000);

      const html = await page.content();
      const discoveredLinks = await this.extractLinks(page, url);

      return {
        url,
        html,
        statusCode,
        contentLength: html.length,
        discoveredLinks,
      };
    } catch (error) {
      logger.debug(`Playwright fetch failed for ${url}: ${(error as Error).message}`);
      return null;
    } finally {
      signal?.removeEventListener('abort', abortPage);
      await page.close().catch(() => undefined);
    }
  }

  private async extractLinks(
    page: import('playwright').Page,
    baseUrl: string
  ): Promise<string[]> {
    const hrefs = await page.$$eval('a[href]', (els) =>
      els.map((el) => el.getAttribute('href')).filter(Boolean)
    );

    const links: string[] = [];
    for (const href of hrefs) {
      if (!href) continue;
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:'))
        continue;

      const resolved = resolveUrl(baseUrl, href);
      if (!resolved) continue;
      if (!isValidUrl(resolved)) continue;
      if (!isSameDomain(resolved, baseUrl)) continue;
      if (shouldSkipUrl(resolved)) continue;

      links.push(normalizeUrl(resolved));
    }

    return [...new Set(links)];
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }
}