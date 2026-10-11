import { describe, it, expect, vi, afterEach } from 'vitest';
import { SitemapService } from '../src/services/crawler/SitemapParser';

const URLSET = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a</loc></url>
  <url><loc>https://evil.com/b</loc></url>
  <url><loc>http://127.0.0.1/c</loc></url>
</urlset>`;

describe('SitemapService.getUrls', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps only URLs on the start URL’s domain', async () => {
    vi.spyOn(
      SitemapService.prototype as unknown as { fetch: (url: string) => Promise<string | null> },
      'fetch'
    ).mockResolvedValue(URLSET);

    const urls = await new SitemapService().getUrls('https://example.com/', 10);
    expect(urls).toEqual(['https://example.com/a']);
  });
});
