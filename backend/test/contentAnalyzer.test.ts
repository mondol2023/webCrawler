import { describe, it, expect } from 'vitest';
import { ContentAnalyzer, isEmbedHost } from '../src/services/crawler/ContentAnalyzer';
import { RobotsTxtService, MAX_CRAWL_DELAY_MS } from '../src/services/crawler/RobotsTxtParser';

describe('isEmbedHost', () => {
  it('matches known hosts by hostname, not substring', () => {
    expect(isEmbedHost('https://evil.com/?youtube.com')).toBe(false);
    expect(isEmbedHost('https://youtube.com.evil.com/embed/x')).toBe(false);
    expect(isEmbedHost('https://notyoutube.com/embed/x')).toBe(false);
    expect(isEmbedHost('https://www.youtube.com/embed/x')).toBe(true);
    expect(isEmbedHost('https://player.vimeo.com/video/1')).toBe(true);
    expect(isEmbedHost('https://fast.wistia.net/embed/iframe/a')).toBe(true);
  });

  it('only accepts the facebook video plugin path', () => {
    expect(isEmbedHost('https://www.facebook.com/plugins/video.php?href=x')).toBe(true);
    expect(isEmbedHost('https://www.facebook.com/login')).toBe(false);
  });

  it('rejects non-http schemes and junk', () => {
    expect(isEmbedHost('javascript://youtube.com/%0aalert(1)')).toBe(false);
    expect(isEmbedHost('not a url')).toBe(false);
  });
});

describe('ContentAnalyzer', () => {
  it('keeps only http(s) image URLs', () => {
    const r = new ContentAnalyzer().analyze(
      '<img src="javascript:alert(1)"><img src="/a.png">',
      'https://ex.com/',
      [],
      []
    );
    expect(r.extracted.images).toEqual(['https://ex.com/a.png']);
  });

  it('extracts embeds only from real embed hosts', () => {
    const r = new ContentAnalyzer().analyze(
      '<iframe src="https://evil.com/?youtube.com"></iframe>' +
        '<iframe src="//www.youtube.com/embed/abc"></iframe>',
      'https://ex.com/',
      [],
      []
    );
    expect(r.extracted.videos).toEqual([
      { url: 'https://www.youtube.com/embed/abc', type: 'embed', poster: undefined },
    ]);
  });
});

describe('RobotsTxtService.getCrawlDelay', () => {
  it('caps a huge robots.txt crawl-delay', async () => {
    const svc = new RobotsTxtService();
    // Seed the per-host cache so no network call is made.
    (svc as unknown as { cache: Map<string, unknown> }).cache.set('https://ex.com', {
      getCrawlDelay: () => 86_400,
    });
    expect(await svc.getCrawlDelay('https://ex.com/page')).toBe(MAX_CRAWL_DELAY_MS);
  });
});
