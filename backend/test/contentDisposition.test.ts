import { describe, it, expect } from 'vitest';
import { contentDisposition } from '../src/controllers/media.controller';

describe('contentDisposition', () => {
  it('sends an ASCII fallback plus a UTF-8 filename*', () => {
    expect(contentDisposition('日本語 "test".mp4')).toBe(
      `attachment; filename="___ _test_.mp4"; filename*=UTF-8''${encodeURIComponent('日本語 "test".mp4')}`
    );
  });
});
