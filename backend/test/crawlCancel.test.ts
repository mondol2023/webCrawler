import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../src/queue/crawl.queue', () => ({
  CRAWL_QUEUE_NAME: 'crawl-jobs',
  addCrawlJob: vi.fn(),
  removeCrawlJob: vi.fn().mockResolvedValue(undefined),
}));

import { CrawlJob } from '../src/models/CrawlJob.model';
import { claimCrawlJob } from '../src/queue/crawl.worker';
import { cancelCrawlJob } from '../src/controllers/crawl.controller';
import { removeCrawlJob } from '../src/queue/crawl.queue';

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

  it('400s with the current status when the job is already running', async () => {
    vi.mocked(removeCrawlJob).mockClear();
    vi.spyOn(CrawlJob, 'findOneAndUpdate').mockResolvedValue(null as never);
    vi.spyOn(CrawlJob, 'findOne').mockResolvedValue({ status: 'running' } as never);
    const res = stubRes();
    await cancelCrawlJob(req(ID), res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect((res.body as { message: string }).message).toBe("Cannot cancel a job with status 'running'");
    expect(removeCrawlJob).not.toHaveBeenCalled();
  });
});
