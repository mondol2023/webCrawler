import { configureStore } from '@reduxjs/toolkit';
import { baseApi } from '@/features/api/baseApi';
import authReducer from '@/features/auth/authSlice';
import crawlReducer from '@/features/crawl/crawlSlice';

// Ensure endpoint definitions are registered with the base API before the
// store is created (side-effect imports).
import '@/features/auth/authApi';
import '@/features/crawl/crawlApi';
import '@/features/admin/adminApi';

export const store = configureStore({
  reducer: {
    [baseApi.reducerPath]: baseApi.reducer,
    auth: authReducer,
    crawl: crawlReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(baseApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
