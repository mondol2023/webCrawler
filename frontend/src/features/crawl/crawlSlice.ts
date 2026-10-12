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

/**
 * Status to show for a job: the live socket state, except that a persisted
 * `cancelling` beats a live `running` (progress events keep arriving until the
 * worker notices the cancel and stamp `running` on the live entry).
 */
export function resolveStatus(
  live: LiveJobState | undefined,
  persisted: CrawlJobStatus
): CrawlJobStatus {
  if (persisted === 'cancelling' && (!live || live.status === 'running')) return 'cancelling';
  return live?.status ?? persisted;
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
    jobCancelled(state, action: PayloadAction<{ jobId: string }>) {
      const live = state.live[action.payload.jobId];
      if (live) live.status = 'cancelled';
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
  jobCancelled,
  clearLiveJob,
} = crawlSlice.actions;
export default crawlSlice.reducer;
