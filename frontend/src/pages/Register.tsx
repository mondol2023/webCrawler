import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/Misc';
import { useRegisterMutation } from '@/features/auth/authApi';
import { getApiErrorMessage } from '@/lib/apiError';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [register, { isLoading, error }] = useRegisterMutation();
  const navigate = useNavigate();

  const [localError, setLocalError] = useState<string>();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setLocalError('Password must be at least 8 characters.');
      return;
    }
    setLocalError(undefined);
    try {
      await register({ name, email, password }).unwrap();
      navigate('/', { replace: true });
    } catch {
      /* surfaced via `error` */
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start crawling the web in seconds."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {(localError || error) && <ErrorState message={localError ?? getApiErrorMessage(error)} />}
        <Input
          label="Full name"
          name="name"
          autoComplete="name"
          placeholder="Ada Lovelace"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="Use 8 or more characters."
          required
        />
        <Button type="submit" size="lg" loading={isLoading} className="w-full">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
