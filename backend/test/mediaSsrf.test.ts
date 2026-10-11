import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../src/queue/media.queue', () => ({
  addMediaJob: vi.fn().mockResolvedValue(undefined),
  removeMediaJob: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/services/media/YtDlpAdapter', () => ({
  download: vi.fn(),
  isAvailable: vi.fn(),
  hasCookies: vi.fn(),
}));

import { probeUrl, startDownloads } from '../src/controllers/media.controller';
import { MediaProbeService } from '../src/services/media/MediaProbeService';
import { MediaDownload } from '../src/models/MediaDownload.model';
import { MediaDownloadService } from '../src/services/media/MediaDownloadService';
import * as ytdlp from '../src/services/media/YtDlpAdapter';

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

function req(body: unknown): Request {
  return { body, user: { userId: '64b000000000000000000001' } } as unknown as Request;
}

const item = (over: Record<string, unknown> = {}) => ({
  pageUrl: 'https://example.com/',
  url: 'https://example.com/v.mp4',
  kind: 'video',
  source: 'ytdlp',
  label: 'x',
  ...over,
});

describe('media controller SSRF checks', () => {
  afterEach(() => vi.restoreAllMocks());

  it('probe rejects a private user proxy with 400', async () => {
    vi.spyOn(MediaProbeService.prototype, 'probe').mockResolvedValue({} as never);
    const res = stubRes();
    await probeUrl(req({ url: 'https://example.com/', proxyUrl: 'http://127.0.0.1:6379' }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
  });

  it('downloads rejects a private user proxy with 400', async () => {
    vi.spyOn(MediaDownload, 'countDocuments').mockResolvedValue(0 as never);
    const create = vi.spyOn(MediaDownload, 'create').mockResolvedValue({} as never);
    const res = stubRes();
    await startDownloads(req({ items: [item()], proxyUrl: 'http://127.0.0.1:6379' }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['url', { url: 'http://169.254.169.254/' }],
    ['pageUrl', { pageUrl: 'http://127.0.0.1:8080/' }],
  ])('downloads rejects a private item %s with 400', async (_name, over) => {
    vi.spyOn(MediaDownload, 'countDocuments').mockResolvedValue(0 as never);
    const create = vi.spyOn(MediaDownload, 'create').mockResolvedValue({} as never);
    const res = stubRes();
    await startDownloads(req({ items: [item(), item(over)] }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('MediaDownloadService.run SSRF check', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fails a yt-dlp download of a private URL without invoking yt-dlp', async () => {
    const record = {
      _id: '64b000000000000000000002',
      userId: '64b000000000000000000001',
      status: 'queued',
      source: 'ytdlp',
      kind: 'video',
      audioOnly: false,
      sourceUrl: 'http://169.254.169.254/latest/meta-data/',
      pageUrl: 'https://example.com/',
      save: vi.fn().mockResolvedValue(undefined),
      toJSON: () => ({}),
    } as Record<string, unknown>;
    vi.spyOn(MediaDownload, 'findById').mockResolvedValue(record as never);

    await new MediaDownloadService().run('64b000000000000000000002');

    expect(ytdlp.download).not.toHaveBeenCalled();
    expect(record.status).toBe('failed');
  });
});
