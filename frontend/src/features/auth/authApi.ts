import { baseApi } from '../api/baseApi';
import { setUser, clearUser } from './authSlice';
import type { User } from '@/lib/types';

interface AuthResponse {
  success: boolean;
  message?: string;
  data: { user: User; accessToken: string };
}

interface MeResponse {
  success: boolean;
  data: { user: User };
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
}

export const authApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    login: build.mutation<AuthResponse, LoginRequest>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(setUser(data.data.user));
        } catch {
          /* handled by the component via the returned error */
        }
      },
      invalidatesTags: ['Me', 'Job', 'Stats'],
    }),

    register: build.mutation<AuthResponse, RegisterRequest>({
      query: (body) => ({ url: '/auth/register', method: 'POST', body }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(setUser(data.data.user));
        } catch {
          /* noop */
        }
      },
      invalidatesTags: ['Me'],
    }),

    getMe: build.query<MeResponse, void>({
      query: () => '/auth/me',
      providesTags: ['Me'],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(setUser(data.data.user));
        } catch {
          dispatch(clearUser());
        }
      },
    }),

    logout: build.mutation<{ success: boolean }, void>({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
        } finally {
          dispatch(clearUser());
          // Drop all cached data belonging to the previous session.
          dispatch(baseApi.util.resetApiState());
        }
      },
    }),
  }),
});

export const {
  useLoginMutation,
  useRegisterMutation,
  useGetMeQuery,
  useLogoutMutation,
} = authApi;
