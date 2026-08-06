import { baseApi } from '../api/baseApi';
import type {
  MediaCandidate,
  MediaCapabilities,
  MediaDownload,
  Pagination,
  ProbeOutcome,
} from '@/lib/types';

export interface ProbeRequest {
  url: string;
  proxyUrl?: string;
  respectRobotsTxt: boolean;
}

/** One selected asset, trimmed to the fields the backend accepts. */
export interface DownloadItem {
  pageUrl: string;
  url: string;
  kind: MediaCandidate['kind'];
  source: MediaCandidate['source'];
  label: string;
  quality?: string;
  formatId?: string;
  audioOnly: boolean;
}

export interface StartDownloadsRequest {
  items: DownloadItem[];
  proxyUrl?: string;
}

interface ProbeResponse {
  success: boolean;
  data: ProbeOutcome;
}

interface CapabilitiesResponse {
  success: boolean;
  data: MediaCapabilities;
}

interface StartDownloadsResponse {
  success: boolean;
  message: string;
  data: { downloads: MediaDownload[]; skipped: number };
}

interface DownloadListResponse {
  success: boolean;
  data: { downloads: MediaDownload[]; pagination: Pagination };
}

export const mediaApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getMediaCapabilities: build.query<CapabilitiesResponse, void>({
      query: () => '/media/capabilities',
    }),

    // A probe is an action, not a cache entry — the same URL can yield different
    // results through a different proxy, so it must not be memoised.
    probeMedia: build.mutation<ProbeResponse, ProbeRequest>({
      query: (body) => ({ url: '/media/probe', method: 'POST', body }),
    }),

    startMediaDownloads: build.mutation<StartDownloadsResponse, StartDownloadsRequest>({
      query: (body) => ({ url: '/media/downloads', method: 'POST', body }),
      invalidatesTags: [{ type: 'Media', id: 'LIST' }],
    }),

    listMediaDownloads: build.query<DownloadListResponse, { page?: number; limit?: number }>({
      query: ({ page = 1, limit = 20 } = {}) => ({
        url: '/media/downloads',
        params: { page, limit },
      }),
      providesTags: [{ type: 'Media', id: 'LIST' }],
    }),

    deleteMediaDownload: build.mutation<{ success: boolean }, string>({
      query: (id) => ({ url: `/media/downloads/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Media', id: 'LIST' }],
    }),
  }),
});

export const {
  useGetMediaCapabilitiesQuery,
  useProbeMediaMutation,
  useStartMediaDownloadsMutation,
  useListMediaDownloadsQuery,
  useDeleteMediaDownloadMutation,
} = mediaApi;

/** Browser URL for a finished download; the cookie authenticates the request. */
export function mediaFileUrl(id: string): string {
  return `/api/media/downloads/${id}/file`;
}
