import { describe, it, expect, vi } from 'vitest';

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ isConnected: () => true, close: vi.fn() }), 0)
        )
    ),
  },
}));

import { chromium } from 'playwright';
import { getBrowser } from '../src/services/crawler/PlaywrightCrawler';

describe('getBrowser', () => {
  it('launches Chromium once for concurrent callers', async () => {
    const [a, b, c] = await Promise.all([getBrowser(), getBrowser(), getBrowser()]);
    expect(chromium.launch).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
