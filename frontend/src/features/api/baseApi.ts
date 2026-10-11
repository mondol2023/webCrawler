import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';
import { Mutex } from './mutex';
import { clearUser } from '../auth/authSlice';

const rawBaseQuery = fetchBaseQuery({
  baseUrl: '/api',
  credentials: 'include',
});

// Single-flight guard so concurrent 401s trigger only one refresh call.
const refreshMutex = new Mutex();

/**
 * Base query that transparently refreshes the access token on a 401 and retries
 * the original request once. Tokens live in httpOnly cookies, so the browser
 * sends them automatically — we only need to hit the refresh endpoint.
 */
const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  await refreshMutex.wait();

  let result = await rawBaseQuery(args, api, extraOptions);

  // A 401 from login/register/refresh is a real answer, not an expired token.
  const url = typeof args === 'string' ? args : args.url;
  const isAuthCall = url.replace(/^\//, '').startsWith('auth/');

  if (result.error?.status === 401 && !isAuthCall) {
    if (!refreshMutex.isLocked()) {
      const release = await refreshMutex.acquire();
      try {
        const refresh = await rawBaseQuery(
          { url: '/auth/refresh', method: 'POST' },
          api,
          extraOptions
        );
        if (refresh.data) {
          // Retry the original request with the refreshed cookie.
          result = await rawBaseQuery(args, api, extraOptions);
        } else {
          // Refresh token is gone or expired — drop the session so guards redirect.
          api.dispatch(clearUser());
        }
      } finally {
        release();
      }
    } else {
      // A refresh is already in flight — wait for it, then retry.
      await refreshMutex.wait();
      result = await rawBaseQuery(args, api, extraOptions);
    }
  }

  return result;
};

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: ['Job', 'Result', 'User', 'Stats', 'Me', 'Media'],
  endpoints: () => ({}),
});
