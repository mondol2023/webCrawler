import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type { SerializedError } from '@reduxjs/toolkit';

type ApiErrorBody = {
  message?: string;
  errors?: Record<string, string[]>;
};

/** Extract a human-readable message from an RTK Query error. */
export function getApiErrorMessage(
  error: FetchBaseQueryError | SerializedError | undefined,
  fallback = 'Something went wrong. Please try again.'
): string {
  if (!error) return fallback;

  // FetchBaseQueryError with a JSON body from our API.
  if ('status' in error) {
    const data = error.data as ApiErrorBody | undefined;
    if (data?.message) return data.message;
    if (data?.errors) {
      const first = Object.values(data.errors).flat()[0];
      if (first) return first;
    }
    if (error.status === 'FETCH_ERROR') return 'Cannot reach the server.';
    return fallback;
  }

  // SerializedError.
  return error.message ?? fallback;
}
