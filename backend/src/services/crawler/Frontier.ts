import { normalizeUrl, shouldSkipUrl } from '../../utils/urlUtils';

export interface FrontierEntry {
  url: string;
  depth: number;
}

/** Queue holds this many consumed slots before the array is compacted. */
const COMPACT_THRESHOLD = 1024;

/**
 * FIFO crawl frontier. Every URL is accepted at most once for the lifetime of
 * the crawl (queued *or* already fetched), so a page linked from hundreds of
 * pages is queued and fetched exactly once, and the queue never holds
 * duplicates. Links past `maxDepth` and URLs we never fetch are rejected at
 * enqueue time rather than carried around until dequeue.
 */
export class Frontier {
  private items: FrontierEntry[] = [];
  private head = 0;
  private readonly seen = new Set<string>();

  constructor(private readonly maxDepth: number) {}

  /** Returns true when the URL was newly queued. */
  push(url: string, depth: number): boolean {
    if (depth > this.maxDepth) return false;
    const key = normalizeUrl(url);
    if (shouldSkipUrl(key) || this.seen.has(key)) return false;
    this.seen.add(key);
    this.items.push({ url: key, depth });
    return true;
  }

  /** O(1) dequeue (amortised): advances a head index instead of Array#shift. */
  shift(): FrontierEntry | undefined {
    if (this.head >= this.items.length) return undefined;
    const entry = this.items[this.head++];
    if (this.head >= COMPACT_THRESHOLD && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return entry;
  }

  /** URLs queued and not yet dequeued. */
  get pending(): number {
    return this.items.length - this.head;
  }

  /** Every URL ever accepted: queued, in flight, or done. */
  get discovered(): number {
    return this.seen.size;
  }
}
