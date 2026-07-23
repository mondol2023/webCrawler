import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { User } from '@/lib/types';

interface AuthState {
  user: User | null;
  /** false until the first /me check resolves, so guards can show a loader. */
  initialized: boolean;
}

const initialState: AuthState = {
  user: null,
  initialized: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setUser(state, action: PayloadAction<User | null>) {
      state.user = action.payload;
      state.initialized = true;
    },
    clearUser(state) {
      state.user = null;
      state.initialized = true;
    },
  },
});

export const { setUser, clearUser } = authSlice.actions;
export default authSlice.reducer;
