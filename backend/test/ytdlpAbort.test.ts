import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';

function fakeChild(onSpawn: (child: FakeChild) => void) {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => {
    setImmediate(() => child.emit('close', null));
    return true;
  });
  setImmediate(() => onSpawn(child));
  return child;
}
type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

const spawned: FakeChild[] = [];
vi.mock('child_process', () => ({
  spawn: vi.fn((_bin: string, args: string[]) => {
    const child = fakeChild((c) => {
      if (args[0] === '--version') {
        c.stdout.emit('data', Buffer.from('2024.01.01\n'));
        c.emit('close', 0);
      }
      // A download never finishes on its own.
    });
    spawned.push(child);
    return child;
  }),
}));

import { download } from '../src/services/media/YtDlpAdapter';

describe('yt-dlp download abort', () => {
  it('kills the child with SIGKILL and resolves aborted', async () => {
    const controller = new AbortController();
    const pending = download({
      url: 'https://example.com/v',
      audioOnly: false,
      outputTemplate: '/tmp/x',
      proxy: null,
      maxBytes: 1000,
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    const result = await pending;

    expect(result.aborted).toBe(true);
    expect(result.ok).toBe(false);
    const child = spawned[spawned.length - 1];
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('does not spawn when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const before = spawned.length;
    const result = await download({
      url: 'https://example.com/v',
      audioOnly: false,
      outputTemplate: '/tmp/x',
      proxy: null,
      maxBytes: 1000,
      signal: controller.signal,
    });
    expect(result.aborted).toBe(true);
    expect(spawned.length).toBe(before);
  });
});
