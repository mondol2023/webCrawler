import { baseApi } from '../api/baseApi';
import type { CrawlJob, PlatformStats, Pagination, User } from '@/lib/types';

interface StatsResponse {
  success: boolean;
  data: PlatformStats;
}

interface UserListResponse {
  success: boolean;
  data: { users: User[]; pagination: Pagination };
}

interface UserResponse {
  success: boolean;
  data: { user: User };
}

interface JobListResponse {
  success: boolean;
  data: { jobs: CrawlJob[]; pagination: Pagination };
}

export interface ListUsersArgs {
  page?: number;
  limit?: number;
  search?: string;
}

export const adminApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getStats: build.query<StatsResponse, void>({
      query: () => '/admin/stats',
      providesTags: ['Stats'],
    }),

    listUsers: build.query<UserListResponse, ListUsersArgs>({
      query: ({ page = 1, limit = 20, search }) => ({
        url: '/admin/users',
        params: { page, limit, ...(search ? { search } : {}) },
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.data.users.map((u) => ({ type: 'User' as const, id: u._id })),
              { type: 'User' as const, id: 'LIST' },
            ]
          : [{ type: 'User' as const, id: 'LIST' }],
    }),

    toggleUserStatus: build.mutation<UserResponse, string>({
      query: (userId) => ({
        url: `/admin/users/${userId}/toggle-status`,
        method: 'PATCH',
      }),
      invalidatesTags: (_r, _e, userId) => [
        { type: 'User', id: userId },
        { type: 'User', id: 'LIST' },
      ],
    }),

    updateCrawlLimit: build.mutation<UserResponse, { userId: string; crawlLimit: number }>({
      query: ({ userId, crawlLimit }) => ({
        url: `/admin/users/${userId}/crawl-limit`,
        method: 'PATCH',
        body: { crawlLimit },
      }),
      invalidatesTags: (_r, _e, { userId }) => [{ type: 'User', id: userId }],
    }),

    listAllJobs: build.query<JobListResponse, { page?: number; limit?: number; status?: string }>({
      query: ({ page = 1, limit = 20, status }) => ({
        url: '/admin/jobs',
        params: { page, limit, ...(status ? { status } : {}) },
      }),
      providesTags: [{ type: 'Job', id: 'ADMIN_LIST' }],
    }),
  }),
});

export const {
  useGetStatsQuery,
  useListUsersQuery,
  useToggleUserStatusMutation,
  useUpdateCrawlLimitMutation,
  useListAllJobsQuery,
} = adminApi;
