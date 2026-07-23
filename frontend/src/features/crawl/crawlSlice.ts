import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { CrawlJobStatus, JobProgress } from '@/lib/types';

export interface LiveJobState extends JobProgress {
  status: CrawlJobStatus;
  error?: string;
}

interface CrawlState {
  /** jobId → most recent realtime state received over the socket. */
  live: Record<string, LiveJobState>;
}

const initialState: CrawlState = {
  live: {},
};

const crawlSlice = createSlice({
  name: 'crawl',
  initialState,
  reducers: {
    jobProgress(state, action: PayloadAction<JobProgress>) {
      const { jobId } = action.payload;
      state.live[jobId] = {
        ...state.live[jobId],
        ...action.payload,
        status: 'running',
      };
    },
    jobStarted(state, action: PayloadAction<{ jobId: string }>) {
      const prev = state.live[action.payload.jobId];
      state.live[action.payload.jobId] = {
        jobId: action.payload.jobId,
        progress: prev?.progress ?? 0,
        pagesCrawled: prev?.pagesCrawled ?? 0,
        pagesMatched: prev?.pagesMatched ?? 0,
        pagesDiscovered: prev?.pagesDiscovered ?? 0,
        status: 'running',
      };
    },
    jobCompleted(state, action: PayloadAction<{ jobId: string }>) {
      const live = state.live[action.payload.jobId];
      if (live) {
        live.status = 'completed';
        live.progress = 100;
      }
    },
    jobFailed(state, action: PayloadAction<{ jobId: string; error?: string }>) {
      const live = state.live[action.payload.jobId];
      if (live) {
        live.status = 'failed';
        live.error = action.payload.error;
      }
    },
    clearLiveJob(state, action: PayloadAction<string>) {
      delete state.live[action.payload];
    },
  },
});

export const {
  jobProgress,
  jobStarted,
  jobCompleted,
  jobFailed,
  clearLiveJob,
} = crawlSlice.actions;
export default crawlSlice.reducer;
