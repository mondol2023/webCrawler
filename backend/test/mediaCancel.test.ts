import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { Readable } from 'stream';
import { mkdir, mkdtemp, readdir, writeFile, rm } from 'fs/promises';
import path from 'path';

let tmpDir = '';
vi.mock('../src/services/media/storage', async (orig) => ({
  ...(await orig<typeof import('../src/services/media/storage')>()),
  userDir: vi.fn(async () => tmpDir),
}));
vi.mock('../src/services/media/YtDlpAdapter', () => ({
  download: vi.fn(),
  isAvailable: vi.fn(),
  hasCookies: vi.fn(),
}));
vi.mock('../src/queue/media.queue', () => ({
  addMediaJob: vi.fn().mockResolvedValue(undefined),
  removeMediaJob: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('axios', () => ({ default: { get: vi.fn() } }));

import axios from 'axios';
import type { Request, Response } from 'express';
import { MediaDownload } from '../src/models/MediaDownload.model';
import { MediaDownloadService } from '../src/services/media/MediaDownloadService';
import * as ytdlp from '../src/services/media/YtDlpAdapter';
import { cancel, register, unregister } from '../src/services/media/activeDownloads';
import { deleteDownload } from '../src/controllers/media.controller';
import { MEDIA_ROOT } from '../src/services/media/storage';

const ID = '64b000000000000000000003';

function fakeRecord(over: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => ID },
    userId: { toString: () => '64b000000000000000000001' },
    status: 'queued',
    source: 'direct',
    kind: 'video',
    audioOnly: false,
    sourceUrl: 'https://93.184.216.34/v.mp4',
    pageUrl: 'https://93.184.216.34/',
    save: vi.fn().mockResolvedValue(undefined),
    toJSON: () => ({}),
    ...over,
  } as Record<string, unknown> & { save: ReturnType<typeof vi.fn>; status: string };
}

describe('MediaDownloadService cancellation', () => {
  beforeEach(async () => {
    // removeFile refuses paths outside MEDIA_ROOT, so the scratch dir lives there.
    await mkdir(MEDIA_ROOT, { recursive: true });
    tmpDir = await mkdtemp(path.join(MEDIA_ROOT, 'test-cancel-'));
    vi.spyOn(MediaDownload, 'updateOne').mockReturnValue({ catch: () => undefined } as never);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('a cancelled direct stream leaves no file and saves nothing after start', async () => {
    const record = fakeRecord();
    vi.spyOn(MediaDownload, 'findById').mockResolvedValue(record as never);
    vi.mocked(axios.get).mockImplementation(async (_url, config) => {
      const stream = new Readable({ read() {} });
      const signal = (config as { signal: AbortSignal }).signal;
      signal.addEventListener('abort', () => stream.destroy(new Error('canceled')));
      setImmediate(() => {
        stream.push(Buffer.alloc(1024));
        setImmediate(() => cancel(ID));
      });
      return { status: 200, headers: { 'content-type': 'video/mp4' }, data: stream } as never;
    });

    await new MediaDownloadService().run(ID);

    expect(record.save).toHaveBeenCalledTimes(1); // only the 'downloading' save
    expect(record.status).toBe('downloading');
    expect(await readdir(tmpDir)).toEqual([]);
    // The id is no longer registered once the run ends.
    expect(cancel(ID)).toBe(false);
  });

  it('an aborted yt-dlp run removes partial files and saves nothing after start', async () => {
    const record = fakeRecord({ source: 'ytdlp' });
    vi.spyOn(MediaDownload, 'findById').mockResolvedValue(record as never);
    vi.mocked(ytdlp.download).mockImplementation(async (opts) => {
      await writeFile(path.join(tmpDir, `${ID}.f137.mp4.part`), 'x');
      await writeFile(path.join(tmpDir, `${ID}.f140.m4a`), 'x');
      expect(opts.signal).toBeDefined();
      return { ok: false, restriction: { kind: 'none' }, aborted: true } as never;
    });

    await new MediaDownloadService().run(ID);

    expect(record.save).toHaveBeenCalledTimes(1);
    expect(await readdir(tmpDir)).toEqual([]);
  });

  it('deleteDownload aborts the in-flight run', async () => {
    const signal = register(ID);
    const record = fakeRecord({ status: 'downloading', deleteOne: vi.fn() });
    vi.spyOn(MediaDownload, 'findOne').mockResolvedValue(record as never);
    const res = { status: () => res, json: () => res } as unknown as Response;
    const req = { params: { id: ID }, user: { userId: '64b000000000000000000001', role: 'user' } } as unknown as Request;

    await deleteDownload(req, res);

    expect(signal.aborted).toBe(true);
    unregister(ID);
  });
});
