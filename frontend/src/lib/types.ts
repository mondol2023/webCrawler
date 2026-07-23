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

export interface ExtractedData {
  headings: string[];
  paragraphs: string[];
  links: string[];
  images: string[];
  metaTitle?: string;
  metaDescription?: string;
  structuredData: Record<string, unknown>[];
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

/** Live progress payload emitted over Socket.io during a crawl. */
export interface JobProgress {
  jobId: string;
  progress: number;
  pagesCrawled: number;
  pagesMatched: number;
  pagesDiscovered: number;
}
