import { baseApi } from '../api/baseApi';
import type { CrawlJob, CrawlResult, Pagination } from '@/lib/types';

export interface SubmitCrawlRequest {
  url: string;
  keywords: string[];
  phrases: string[];
  categories: string[];
  maxDepth: number;
  maxPages: number;
  respectRobotsTxt: boolean;
}

interface JobListResponse {
  success: boolean;
  data: { jobs: CrawlJob[]; pagination: Pagination };
}

interface JobResponse {
  success: boolean;
  data: { job: CrawlJob };
}

interface ResultsResponse {
  success: boolean;
  data: { results: CrawlResult[]; pagination: Pagination };
}

export interface ListJobsArgs {
  page?: number;
  limit?: number;
  status?: string;
}

export interface ListResultsArgs {
  jobId: string;
  page?: number;
  limit?: number;
  minScore?: number;
}

export const crawlApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    submitCrawl: build.mutation<JobResponse, SubmitCrawlRequest>({
      query: (body) => ({ url: '/crawl', method: 'POST', body }),
      invalidatesTags: [{ type: 'Job', id: 'LIST' }],
    }),

    listJobs: build.query<JobListResponse, ListJobsArgs>({
      query: ({ page = 1, limit = 10, status }) => ({
        url: '/crawl',
        params: { page, limit, ...(status ? { status } : {}) },
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.data.jobs.map((j) => ({ type: 'Job' as const, id: j._id })),
              { type: 'Job' as const, id: 'LIST' },
            ]
          : [{ type: 'Job' as const, id: 'LIST' }],
    }),

    getJob: build.query<JobResponse, string>({
      query: (jobId) => `/crawl/${jobId}`,
      providesTags: (_r, _e, jobId) => [{ type: 'Job', id: jobId }],
    }),

    getJobResults: build.query<ResultsResponse, ListResultsArgs>({
      query: ({ jobId, page = 1, limit = 20, minScore = 0 }) => ({
        url: `/crawl/${jobId}/results`,
        params: { page, limit, minScore },
      }),
      providesTags: (_r, _e, { jobId }) => [{ type: 'Result', id: jobId }],
    }),

    cancelJob: build.mutation<{ success: boolean }, string>({
      query: (jobId) => ({ url: `/crawl/${jobId}/cancel`, method: 'PATCH' }),
      invalidatesTags: (_r, _e, jobId) => [
        { type: 'Job', id: jobId },
        { type: 'Job', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useSubmitCrawlMutation,
  useListJobsQuery,
  useGetJobQuery,
  useGetJobResultsQuery,
  useCancelJobMutation,
} = crawlApi;
