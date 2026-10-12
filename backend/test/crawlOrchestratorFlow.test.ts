import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { CrawlOrchestrator } from '../src/services/crawler/CrawlOrchestrator';
import { CheerioCrawler } from '../src/services/crawler/CheerioCrawler';
import { PlaywrightCrawler } from '../src/services/crawler/PlaywrightCrawler';
import { SitemapService } from '../src/services/crawler/SitemapParser';
import { RobotsTxtService } from '../src/services/crawler/RobotsTxtParser';
import { CrawlResult } from '../src/models/CrawlResult.model';
import { CrawlJob } from '../src/models/CrawlJob.model';
import * as socket from '../src/services/socketService';

const JOB = new mongoose.Types.ObjectId().toString();
const USER = new mongoose.Types.ObjectId().toString();

const page = (url: string, links: string[]) => ({
  url,
  html: `<html><head><title>${url}</title></head><body>${'word '.repeat(200)}</body></html>`,
  statusCode: 200,
  contentLength: 1000,
  discoveredLinks: links,
});

const opts = (over: Partial<Parameters<CrawlOrchestrator['run']>[0]> = {}) => ({
  jobId: JOB,
  userId: USER,
  url: 'https://site.test/',
  keywords: [],
  phrases: [],
  maxDepth: 3,
  maxPages: 100,
  respectRobotsTxt: false,
  ...over,
});

beforeEach(() => {
  vi.spyOn(SitemapService.prototype, 'getUrls').mockResolvedValue([]);
  vi.spyOn(RobotsTxtService.prototype, 'getCrawlDelay').mockResolvedValue(0);
  vi.spyOn(PlaywrightCrawler.prototype, 'close').mockResolvedValue();
  vi.spyOn(CrawlResult, 'findOneAndUpdate').mockResolvedValue({} as never);
  vi.spyOn(CrawlResult, 'updateMany').mockResolvedValue({} as never);
  vi.spyOn(CrawlJob, 'findByIdAndUpdate').mockResolvedValue({} as never);
  vi.spyOn(socket, 'emitToJob').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('CrawlOrchestrator cancellation', () => {
  it('stops fetching within 2s of an abort and reports cancelled, keeping saved results', async () => {
    const fetch = vi
      .spyOn(CheerioCrawler.prototype, 'fetchPage')
      .mockImplementation(async (u: string) =>
        page(u, ['https://site.test/a', 'https://site.test/b', 'https://site.test/c'])
      );
    const ac = new AbortController();
    const started = Date.now();
    const running = new CrawlOrchestrator().run(opts({ signal: ac.signal }));
    // First page is fetched, then the orchestrator is in its politeness sleep.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    ac.abort();
    const outcome = await running;

    expect(Date.now() - started).toBeLessThan(2000);
    expect(outcome.cancelled).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(CrawlResult.findOneAndUpdate).toHaveBeenCalled(); // partial result kept
  });

  it('passes the signal to the HTTP fetch', async () => {
    const fetch = vi
      .spyOn(CheerioCrawler.prototype, 'fetchPage')
      .mockResolvedValue(page('https://site.test/', []));
    const ac = new AbortController();
    await new CrawlOrchestrator().run(opts({ signal: ac.signal }));
    expect(fetch.mock.calls[0][1]).toBe(ac.signal);
  });

  it('never fetches when already aborted, and still closes the browser', async () => {
    const fetch = vi.spyOn(CheerioCrawler.prototype, 'fetchPage').mockResolvedValue(null);
    const ac = new AbortController();
    ac.abort();
    const outcome = await new CrawlOrchestrator().run(opts({ signal: ac.signal }));
    expect(outcome.cancelled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(PlaywrightCrawler.prototype.close).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to Playwright for a fetch that failed only because of the abort', async () => {
    const ac = new AbortController();
    vi.spyOn(CheerioCrawler.prototype, 'fetchPage').mockImplementation(async () => {
      ac.abort();
      return null;
    });
    const pw = vi.spyOn(PlaywrightCrawler.prototype, 'fetchPage').mockResolvedValue(null);
    const outcome = await new CrawlOrchestrator().run(opts({ signal: ac.signal }));
    expect(outcome.cancelled).toBe(true);
    expect(pw).not.toHaveBeenCalled();
  });

  it('reports not cancelled for a normal crawl', async () => {
    vi.spyOn(CheerioCrawler.prototype, 'fetchPage').mockResolvedValue(page('https://site.test/', []));
    const outcome = await new CrawlOrchestrator().run(opts());
    expect(outcome.cancelled).toBe(false);
  });
});

describe('CrawlOrchestrator frontier', () => {
  it('fetches and queues a page linked from many pages exactly once', async () => {
    const shared = 'https://site.test/shared';
    const fetch = vi
      .spyOn(CheerioCrawler.prototype, 'fetchPage')
      .mockImplementation(async (u: string) => {
        if (u === 'https://site.test/') {
          return page(u, [
            'https://site.test/a',
            'https://site.test/b',
            'https://site.test/c',
            shared,
          ]);
        }
        if (u === shared) return page(u, []);
        return page(u, [shared, shared + '/', 'https://site.test']);
      });
    await new CrawlOrchestrator().run(opts());
    const urls = fetch.mock.calls.map((c) => c[0]);
    expect(urls.filter((u) => u === shared)).toHaveLength(1);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toHaveLength(5);
  });

  it('does not queue links beyond maxDepth', async () => {
    const fetch = vi
      .spyOn(CheerioCrawler.prototype, 'fetchPage')
      .mockImplementation(async (u: string) => page(u, [`${u.replace(/\/$/, '')}/n`]));
    const outcome = await new CrawlOrchestrator().run(opts({ maxDepth: 2 }));
    expect(fetch).toHaveBeenCalledTimes(3); // depth 0, 1, 2
    expect(outcome.cancelled).toBe(false);
  });
});

describe('CrawlOrchestrator progress', () => {
  it('emits progress at most once per second regardless of page count', async () => {
    vi.useFakeTimers();
    try {
      const links = Array.from({ length: 30 }, (_, i) => `https://site.test/p${i}`);
      vi.spyOn(CheerioCrawler.prototype, 'fetchPage').mockImplementation(async (u: string) =>
        page(u, u === 'https://site.test/' ? links : [])
      );
      const emit = vi.spyOn(socket, 'emitToJob');
      // Each politeness sleep advances the clock 400ms: 31 pages over ~12s.
      vi.spyOn(CrawlOrchestrator.prototype as never, 'sleep').mockImplementation((async () => {
        vi.advanceTimersByTime(400);
      }) as never);
      await new CrawlOrchestrator().run(opts());
      const progressEmits = emit.mock.calls.filter((c) => c[1] === 'job:progress');
      expect(progressEmits.length).toBeGreaterThan(5);
      expect(progressEmits.length).toBeLessThanOrEqual(13);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports pagesDiscovered as everything ever queued', async () => {
    vi.spyOn(CheerioCrawler.prototype, 'fetchPage').mockImplementation(async (u: string) =>
      page(u, u === 'https://site.test/' ? ['https://site.test/a', 'https://site.test/b'] : [])
    );
    await new CrawlOrchestrator().run(opts({ maxPages: 1 }));
    const last = vi.mocked(CrawlJob.findByIdAndUpdate).mock.calls.at(-1)![1] as {
      pagesDiscovered: number;
    };
    expect(last.pagesDiscovered).toBe(3);
  });
});
