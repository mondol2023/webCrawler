/** Shared domain + API types, mirroring the backend contracts. */

export type Role = 'admin' | 'user';

export type CrawlJobStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface User {
  _id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  crawlLimit: number;
  totalJobsRun: number;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrawlJob {
  _id: string;
  userId: string | Pick<User, '_id' | 'name' | 'email'>;
  url: string;
  keywords: string[];
  phrases: string[];
  categories: string[];
  status: CrawlJobStatus;
  progress: number;
  pagesDiscovered: number;
  pagesCrawled: number;
  pagesMatched: number;
  maxDepth: number;
  maxPages: number;
  respectRobotsTxt: boolean;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VideoItem {
  url: string;
  type: 'file' | 'embed';
  poster?: string;
}

export interface ExtractedData {
  headings: string[];
  paragraphs: string[];
  links: string[];
  images: string[];
  videos: VideoItem[];
  metaTitle?: string;
  metaDescription?: string;
  structuredData: Record<string, unknown>[];
}

export interface CachedContent {
  text: string;
  images: string[];
  videos: VideoItem[];
  sizeBytes: number;
  truncated: boolean;
  cachedAt: string;
}

export interface CrawlResult {
  _id: string;
  jobId: string;
  url: string;
  title: string;
  statusCode: number;
  contentLength: number;
  crawledAt: string;
  relevanceScore: number;
  matchedKeywords: string[];
  matchedPhrases: string[];
  extracted: ExtractedData;
  rawTextSnippet: string;
  depth: number;
  isPrimary: boolean;
  isPublic: boolean;
  /** Present only on the primary result's detail response. */
  cache?: CachedContent;
  createdAt: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface PlatformStats {
  users: { total: number; active: number };
  jobs: { total: number; running: number; completed: number; failed: number };
  results: { total: number };
  jobsPerDay: { _id: string; count: number }[];
}

// ─── Media downloader ───────────────────────────────────────────────────────
// Mirrors backend/src/services/media/types.ts.

export type MediaKind = 'video' | 'audio' | 'image';
export type MediaSource = 'ytdlp' | 'dom' | 'network' | 'meta';

export type RestrictionKind =
  | 'none'
  | 'geo'
  | 'login'
  | 'paywall'
  | 'drm'
  | 'robots'
  | 'forbidden'
  | 'rate_limited'
  | 'unavailable';

export interface Restriction {
  kind: RestrictionKind;
  message: string;
  /** True only when the block depends on where the request comes from (geo). */
  proxyMayHelp: boolean;
}

export interface MediaCandidate {
  id: string;
  kind: MediaKind;
  source: MediaSource;
  url: string;
  pageUrl: string;
  label: string;
  quality?: string;
  container?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  sizeBytes?: number;
  approximateSize: boolean;
  posterUrl?: string;
  formatId?: string;
  needsMuxing: boolean;
  restriction?: Restriction;
}

export interface ProbeOutcome {
  pageUrl: string;
  pageTitle?: string;
  strategy: 'ytdlp' | 'scanner' | 'hybrid';
  candidates: MediaCandidate[];
  restriction: Restriction;
  warnings: string[];
  usedProxy: boolean;
  durationMs: number;
}

export type MediaDownloadStatus =
  | 'pending'
  | 'queued'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled';

export interface MediaDownload {
  _id: string;
  userId: string;
  pageUrl: string;
  sourceUrl: string;
  kind: MediaKind;
  source: MediaSource;
  label: string;
  quality?: string;
  formatId?: string;
  audioOnly: boolean;
  status: MediaDownloadStatus;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  fileName?: string;
  sizeBytes?: number;
  mimeType?: string;
  restrictionKind?: RestrictionKind;
  restrictionMessage?: string;
  errorMessage?: string;
  usedProxy: boolean;
  proxyLabel?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaCapabilities {
  ytdlp: { available: boolean; version?: string };
  proxyConfigured: boolean;
  /** True when the server has a cookies file for sites that demand a session. */
  cookiesConfigured: boolean;
  maxDownloadBytes: number;
  maxActiveDownloads: number;
}

/** Live progress payload emitted over Socket.io during a crawl. */
export interface JobProgress {
  jobId: string;
  progress: number;
  pagesCrawled: number;
  pagesMatched: number;
  pagesDiscovered: number;
}
