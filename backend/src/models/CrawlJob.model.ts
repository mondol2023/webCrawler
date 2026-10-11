import mongoose, { Document, Model, Schema } from 'mongoose';

export const CRAWL_JOB_STATUSES = [
  'pending',
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export type CrawlJobStatus = (typeof CRAWL_JOB_STATUSES)[number];

export function isCrawlJobStatus(value: unknown): value is CrawlJobStatus {
  return typeof value === 'string' && (CRAWL_JOB_STATUSES as readonly string[]).includes(value);
}

export interface ICrawlJob extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  url: string;                   // target URL
  keywords: string[];            // optional search keywords
  phrases: string[];             // optional phrases
  categories: string[];          // optional categories
  status: CrawlJobStatus;
  progress: number;              // 0–100
  pagesDiscovered: number;
  pagesCrawled: number;
  pagesMatched: number;
  maxDepth: number;
  maxPages: number;
  respectRobotsTxt: boolean;
  bullJobId?: string;
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const crawlJobSchema = new Schema<ICrawlJob>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    url: {
      type: String,
      required: [true, 'Target URL is required'],
      trim: true,
    },
    keywords: {
      type: [String],
      default: [],
    },
    phrases: {
      type: [String],
      default: [],
    },
    categories: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ['pending', 'queued', 'running', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    pagesDiscovered: { type: Number, default: 0 },
    pagesCrawled: { type: Number, default: 0 },
    pagesMatched: { type: Number, default: 0 },
    maxDepth: {
      type: Number,
      default: 3,
      min: 1,
      max: 10,
    },
    maxPages: {
      type: Number,
      default: 100,
      min: 1,
      max: 1000,
    },
    respectRobotsTxt: {
      type: Boolean,
      default: true,
    },
    bullJobId: { type: String },
    startedAt: { type: Date },
    completedAt: { type: Date },
    errorMessage: { type: String },
  },
  { timestamps: true }
);

crawlJobSchema.index({ userId: 1, status: 1 });
crawlJobSchema.index({ createdAt: -1 });

export const CrawlJob: Model<ICrawlJob> = mongoose.model<ICrawlJob>('CrawlJob', crawlJobSchema);