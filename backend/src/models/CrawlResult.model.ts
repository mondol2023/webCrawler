import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IExtractedData {
  headings: string[];
  paragraphs: string[];
  links: string[];
  images: string[];
  metaTitle?: string;
  metaDescription?: string;
  structuredData: Record<string, unknown>[];  // JSON-LD, OpenGraph, etc.
}

export interface ICrawlResult extends Document {
  _id: mongoose.Types.ObjectId;
  jobId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  url: string;
  title: string;
  statusCode: number;
  contentLength: number;
  crawledAt: Date;
  relevanceScore: number;       // 0–100, how well it matches keywords
  matchedKeywords: string[];
  matchedPhrases: string[];
  extracted: IExtractedData;
  rawTextSnippet: string;       // first 500 chars for preview
  depth: number;                // how deep in the site hierarchy
  createdAt: Date;
}

const crawlResultSchema = new Schema<ICrawlResult>(
  {
    jobId: {
      type: Schema.Types.ObjectId,
      ref: 'CrawlJob',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    url: { type: String, required: true },
    title: { type: String, default: '' },
    statusCode: { type: Number, default: 200 },
    contentLength: { type: Number, default: 0 },
    crawledAt: { type: Date, default: Date.now },
    relevanceScore: { type: Number, default: 0, min: 0, max: 100 },
    matchedKeywords: { type: [String], default: [] },
    matchedPhrases: { type: [String], default: [] },
    extracted: {
      headings: { type: [String], default: [] },
      paragraphs: { type: [String], default: [] },
      links: { type: [String], default: [] },
      images: { type: [String], default: [] },
      metaTitle: { type: String },
      metaDescription: { type: String },
      structuredData: { type: [Schema.Types.Mixed], default: [] },
    },
    rawTextSnippet: { type: String, default: '' },
    depth: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

crawlResultSchema.index({ jobId: 1, relevanceScore: -1 });
crawlResultSchema.index({ jobId: 1, url: 1 }, { unique: true });

export const CrawlResult: Model<ICrawlResult> = mongoose.model<ICrawlResult>(
  'CrawlResult',
  crawlResultSchema
);