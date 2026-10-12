import { describe, it, expect } from 'vitest';
import { Frontier } from '../src/services/crawler/Frontier';

describe('Frontier', () => {
  it('queues a URL only once, however it is spelled or how often it is linked', () => {
    const f = new Frontier(3);
    expect(f.push('https://a.com/x', 1)).toBe(true);
    expect(f.push('https://a.com/x/', 1)).toBe(false);
    expect(f.push('https://a.com/x', 2)).toBe(false);
    expect(f.pending).toBe(1);
    expect(f.discovered).toBe(1);
  });

  it('does not re-queue a URL that was already dequeued', () => {
    const f = new Frontier(3);
    f.push('https://a.com/x', 1);
    f.shift();
    expect(f.push('https://a.com/x', 1)).toBe(false);
    expect(f.pending).toBe(0);
    expect(f.discovered).toBe(1);
  });

  it('drops links deeper than maxDepth at enqueue time', () => {
    const f = new Frontier(2);
    expect(f.push('https://a.com/ok', 2)).toBe(true);
    expect(f.push('https://a.com/deep', 3)).toBe(false);
    expect(f.discovered).toBe(1);
  });

  it('drops URLs the crawler never fetches (binary extensions)', () => {
    const f = new Frontier(3);
    expect(f.push('https://a.com/file.pdf', 1)).toBe(false);
  });

  it('dequeues in FIFO order and returns undefined when empty', () => {
    const f = new Frontier(5);
    f.push('https://a.com/1', 0);
    f.push('https://a.com/2', 1);
    expect(f.shift()).toEqual({ url: 'https://a.com/1', depth: 0 });
    expect(f.shift()).toEqual({ url: 'https://a.com/2', depth: 1 });
    expect(f.shift()).toBeUndefined();
  });

  it('dequeues in O(1): 100k entries drain quickly and in order', () => {
    const f = new Frontier(5);
    const n = 100_000;
    for (let i = 0; i < n; i++) f.push(`https://a.com/p${i}`, 1);
    const start = Date.now();
    let last = -1;
    let count = 0;
    for (let e = f.shift(); e; e = f.shift()) {
      const idx = Number(e.url.split('/p')[1]);
      if (idx <= last) throw new Error(`out of order: ${idx} after ${last}`);
      last = idx;
      count++;
    }
    expect(count).toBe(n);
    expect(f.pending).toBe(0);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
