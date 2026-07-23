import { useAppSelector } from '@/app/hooks';

/** Convenience selector for the current auth state. */
export function useAuth() {
  const { user, initialized } = useAppSelector((state) => state.auth);
  return {
    user,
    initialized,
    isAuthenticated: Boolean(user),
    isAdmin: user?.role === 'admin',
  };
}
