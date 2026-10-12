import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../src/queue/crawl.queue', () => ({
  CRAWL_QUEUE_NAME: 'crawl-jobs',
  addCrawlJob: vi.fn(),
  removeCrawlJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/queue/crawlCancelFlag', () => ({
  requestCrawlCancel: vi.fn().mockResolvedValue(undefined),
  isCrawlCancelRequested: vi.fn().mockResolvedValue(false),
  clearCrawlCancel: vi.fn().mockResolvedValue(undefined),
}));

import { CrawlJob } from '../src/models/CrawlJob.model';
import { claimCrawlJob, finalizeCrawl, watchCancel } from '../src/queue/crawl.worker';
import { cancelCrawlJob } from '../src/controllers/crawl.controller';
import { removeCrawlJob } from '../src/queue/crawl.queue';
import { requestCrawlCancel, isCrawlCancelRequested } from '../src/queue/crawlCancelFlag';

const ID = '64b000000000000000000003';

function stubRes() {
  const res = { statusCode: 200, body: undefined as unknown } as {
    statusCode: number;
    body: unknown;
    status: (c: number) => typeof res;
    json: (b: unknown) => typeof res;
  };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  return res;
}
const req = (jobId: string) =>
  ({ params: { jobId }, user: { userId: '64b000000000000000000001' } }) as unknown as Request;

describe('claimCrawlJob', () => {
  afterEach(() => vi.restoreAllMocks());

  it('only claims a pending/queued job on the first attempt', async () => {
    const spy = vi.spyOn(CrawlJob, 'findOneAndUpdate').mockResolvedValue(null as never);
    expect(await claimCrawlJob(ID, '1', 0)).toBeNull();
    const filter = spy.mock.calls[0][0] as { _id: string; status: { $in: string[] } };
    expect(filter._id).toBe(ID);
    expect(filter.status.$in.sort()).toEqual(['pending', 'queued']);
  });

  it('also reclaims a running job on a retry', async () => {
    const spy = vi.spyOn(CrawlJob, 'findOneAndUpdate').mockResolvedValue(null as never);
    await claimCrawlJob(ID, '1', 1);
    const filter = spy.mock.calls[0][0] as { status: { $in: string[] } };
    expect(filter.status.$in.sort()).toEqual(['pending', 'queued', 'running']);
  });
});

describe('cancelCrawlJob', () => {
  afterEach(() => vi.restoreAllMocks());

  it('400s an invalid id', async () => {
    const res = stubRes();
    await cancelCrawlJob(req('nope'), res as unknown as Response);
    expect(res.statusCode).toBe(400);
  });

  it('cancels atomically and removes the queued BullMQ job', async () => {
    const spy = vi.spyOn(CrawlJob, 'findOneAndUpdate').mockResolvedValue({ _id: ID } as never);
    const res = stubRes();
    await cancelCrawlJob(req(ID), res as unknown as Response);
    expect(res.statusCode).toBe(200);
    const filter = spy.mock.calls[0][0] as { status: { $in: string[] } };
    expect(filter.status.$in.sort()).toEqual(['pending', 'queued']);
    expect(removeCrawlJob).toHaveBeenCalledWith(ID);
  });

  it('moves a running job to cancelling and raises the Redis cancel flag', async () => {
    vi.mocked(removeCrawlJob).mockClear();
    vi.mocked(requestCrawlCancel).mockClear();
    const spy = vi
      .spyOn(CrawlJob, 'findOneAndUpdate')
      .mockResolvedValueOnce(null as never) // not pending/queued
      .mockResolvedValueOnce({ _id: ID } as never); // running -> cancelling
    const res = stubRes();
    await cancelCrawlJob(req(ID), res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect((res.body as { message: string }).message).toBe('Cancelling job');
    const filter = spy.mock.calls[1][0] as { status: string };
    expect(filter.status).toBe('running');
    expect(spy.mock.calls[1][1]).toMatchObject({ status: 'cancelling' });
    expect(requestCrawlCancel).toHaveBeenCalledWith(ID);
    expect(removeCrawlJob).not.toHaveBeenCalled();
  });

  it('is idempotent for a job that is already cancelling', async () => {
    vi.mocked(requestCrawlCancel).mockClear();
    vi.spyOn(CrawlJob, 'findOneAndUpdate').mockResolvedValue(null as never);
    vi.spyOn(CrawlJob, 'findOne').mockResolvedValue({ status: 'cancelling' } as never);
    const res = stubRes();
    await cancelCrawlJob(req(ID), res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(requestCrawlCancel).toHaveBeenCalledWith(ID);
  });

  it('400s with the current status when the job already finished', async () => {
    vi.spyOn(CrawlJob, 'findOneAndUpdate').mockResolvedValue(null as never);
    vi.spyOn(CrawlJob, 'findOne').mockResolvedValue({ status: 'completed' } as never);
    const res = stubRes();
    await cancelCrawlJob(req(ID), res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect((res.body as { message: string }).message).toBe("Cannot cancel a job with status 'completed'");
  });

  it('404s a job that does not exist or belongs to someone else', async () => {
    vi.spyOn(CrawlJob, 'findOneAndUpdate').mockResolvedValue(null as never);
    vi.spyOn(CrawlJob, 'findOne').mockResolvedValue(null as never);
    const res = stubRes();
    await cancelCrawlJob(req(ID), res as unknown as Response);
    expect(res.statusCode).toBe(404);
  });
});

describe('finalizeCrawl', () => {
  afterEach(() => vi.restoreAllMocks());

  it('marks a cancelled crawl cancelled, keeping progress', async () => {
    const spy = vi.spyOn(CrawlJob, 'findByIdAndUpdate').mockResolvedValue({} as never);
    expect(await finalizeCrawl(ID, true)).toBe('cancelled');
    expect(spy.mock.calls[0][1]).toMatchObject({ status: 'cancelled' });
    expect(spy.mock.calls[0][1]).not.toHaveProperty('progress');
  });

  it('completes a running job', async () => {
    const spy = vi.spyOn(CrawlJob, 'findOneAndUpdate').mockResolvedValue({ _id: ID } as never);
    expect(await finalizeCrawl(ID, false)).toBe('completed');
    expect((spy.mock.calls[0][0] as { status: string }).status).toBe('running');
  });

  it('turns into cancelled when a cancel request landed just as the crawl finished', async () => {
    vi.spyOn(CrawlJob, 'findOneAndUpdate').mockResolvedValue(null as never);
    const upd = vi.spyOn(CrawlJob, 'findByIdAndUpdate').mockResolvedValue({} as never);
    expect(await finalizeCrawl(ID, false)).toBe('cancelled');
    expect(upd.mock.calls[0][1]).toMatchObject({ status: 'cancelled' });
  });
});

describe('watchCancel', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(isCrawlCancelRequested).mockReset().mockResolvedValue(false);
  });

  it('aborts the signal within a second of the Redis flag appearing, and stops polling on dispose', async () => {
    vi.useFakeTimers();
    const w = watchCancel(ID);
    expect(w.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.signal.aborted).toBe(false);

    vi.mocked(isCrawlCancelRequested).mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.signal.aborted).toBe(true);

    const calls = vi.mocked(isCrawlCancelRequested).mock.calls.length;
    w.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.mocked(isCrawlCancelRequested).mock.calls.length).toBe(calls);
  });

  it('survives a Redis error and keeps polling', async () => {
    vi.useFakeTimers();
    vi.mocked(isCrawlCancelRequested).mockRejectedValueOnce(new Error('redis down'));
    const w = watchCancel(ID);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.signal.aborted).toBe(false);
    vi.mocked(isCrawlCancelRequested).mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.signal.aborted).toBe(true);
    w.dispose();
  });
});
