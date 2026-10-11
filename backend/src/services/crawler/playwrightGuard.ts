import type { Page } from 'playwright';
import { assertPublicUrl } from '../media/netGuard';

/**
 * Aborts every request the page makes (navigations, redirects, subresources,
 * fetch/XHR) whose URL is not a public http(s) address, so a crawled page
 * cannot steer Chromium at localhost or the cloud metadata endpoint.
 *
 * Verdicts are cached per hostname for the life of the page, since one page
 * typically fires dozens of requests at the same few hosts.
 *
 * Playwright tries routes in reverse registration order, so install this
 * before any narrower route that should get first refusal.
 */
export async function installRequestGuard(page: Page): Promise<void> {
  const verdicts = new Map<string, boolean>();

  await page.route('**/*', async (route) => {
    let allowed: boolean;
    try {
      const url = new URL(route.request().url());
      const cached =
        url.protocol === 'http:' || url.protocol === 'https:'
          ? verdicts.get(url.hostname)
          : undefined;
      if (cached !== undefined) {
        allowed = cached;
      } else {
        allowed = await assertPublicUrl(url.href).then(
          () => true,
          () => false
        );
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          verdicts.set(url.hostname, allowed);
        }
      }
    } catch {
      allowed = false;
    }

    if (allowed) await route.continue();
    else await route.abort('blockedbyclient');
  });
}
