import axios from 'axios';
import robotsParser from 'robots-parser';
import { getBaseUrl } from '../../utils/urlUtils';
import { logger } from '../../utils/logger';
import { publicAgents } from '../media/netGuard';

// robots-parser exposes only a default export; derive the instance type from it.
type Robot = ReturnType<typeof robotsParser>;

const USER_AGENT = 'WIPBot';
const ROBOTS_TIMEOUT = 8000;
const DEFAULT_CRAWL_DELAY_MS = 500;

/**
 * Fetches and caches robots.txt per host so the crawler can honour crawl
 * permissions and crawl-delay directives. One instance is created per crawl job,
 * so the cache lifetime is naturally scoped to that job.
 */
export class RobotsTxtService {
  private cache = new Map<string, Robot | null>();

  async isAllowed(url: string): Promise<boolean> {
    const robot = await this.getRobot(url);
    if (!robot) return true; // No robots.txt → allow by default.
    // robots-parser returns undefined when there is no matching rule → allowed.
    return robot.isAllowed(url, USER_AGENT) ?? true;
  }

  async getCrawlDelay(url: string): Promise<number> {
    const robot = await this.getRobot(url);
    if (!robot) return DEFAULT_CRAWL_DELAY_MS;
    const delaySeconds = robot.getCrawlDelay(USER_AGENT);
    return typeof delaySeconds === 'number'
      ? delaySeconds * 1000
      : DEFAULT_CRAWL_DELAY_MS;
  }

  private async getRobot(url: string): Promise<Robot | null> {
    let host: string;
    try {
      host = getBaseUrl(url);
    } catch {
      return null;
    }

    if (this.cache.has(host)) {
      return this.cache.get(host) ?? null;
    }

    const robotsUrl = `${host}/robots.txt`;
    try {
      const response = await axios.get<string>(robotsUrl, {
        ...publicAgents(),
        timeout: ROBOTS_TIMEOUT,
        responseType: 'text',
        maxRedirects: 3,
        headers: { 'User-Agent': USER_AGENT },
        validateStatus: (status) => status < 500,
      });

      // 4xx (e.g. 404) means "no restrictions"; only parse successful bodies.
      const robot =
        response.status >= 200 && response.status < 300 && typeof response.data === 'string'
          ? robotsParser(robotsUrl, response.data)
          : null;

      this.cache.set(host, robot);
      return robot;
    } catch (error) {
      logger.debug(`robots.txt fetch failed for ${host}: ${(error as Error).message}`);
      this.cache.set(host, null);
      return null;
    }
  }
}
