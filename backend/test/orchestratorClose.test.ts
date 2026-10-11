import { describe, it, expect, vi } from 'vitest';
import { CrawlOrchestrator } from '../src/services/crawler/CrawlOrchestrator';
import { SitemapService } from '../src/services/crawler/SitemapParser';
import { PlaywrightCrawler } from '../src/services/crawler/PlaywrightCrawler';

describe('CrawlOrchestrator', () => {
  it('closes the Playwright context when the crawl throws', async () => {
    vi.spyOn(SitemapService.prototype, 'getUrls').mockRejectedValue(new Error('boom'));
    const close = vi.spyOn(PlaywrightCrawler.prototype, 'close').mockResolvedValue();

    await expect(
      new CrawlOrchestrator().run({
        jobId: '64b000000000000000000009',
        userId: '64b000000000000000000001',
        url: 'https://example.com/',
        keywords: [],
        phrases: [],
        maxDepth: 1,
        maxPages: 1,
        respectRobotsTxt: false,
      })
    ).rejects.toThrow('boom');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
