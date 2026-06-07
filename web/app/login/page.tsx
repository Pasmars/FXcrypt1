'use client';

import { useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Logo } from '@/components/Logo';
import { Button, Input, Label } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    auth.authStateReady().then(() => {
      if (auth.currentUser) router.replace('/');
    });
  }, [router]);

  const mapError = (code: string, fallback: string) =>
    ({
      'auth/invalid-credential': 'Incorrect email or password.',
      'auth/wrong-password': 'Incorrect email or password.',
      'auth/user-not-found': 'No account found with that email.',
      'auth/too-many-requests': 'Too many failed attempts. Try again later or reset your password.',
      'auth/network-request-failed': 'Network error. Please check your connection and try again.',
      'auth/invalid-email': 'Please enter a valid email address.'
    }[code] || fallback);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      router.replace('/');
    } catch (err: any) {
      setMsg({ text: mapError(err.code, err.message), error: true });
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!email.trim()) {
      setMsg({ text: 'Enter your email address above first.', error: true });
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMsg({ text: 'Password reset email sent — check your inbox.', error: false });
    } catch (err: any) {
      setMsg({ text: mapError(err.code, err.message), error: true });
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-8 flex justify-center">
          <Logo size={48} />
        </div>

        <div className="card p-7">
          <h2 className="text-center text-2xl font-bold">Log In</h2>
          <p className="mb-6 mt-1 text-center text-sm text-muted">Enter your email and password to sign in.</p>

          {msg && (
            <div
              className={`mb-5 rounded-xl px-4 py-3 text-center text-sm font-medium ${
                msg.error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'
              }`}
            >
              {msg.text}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="pr-16"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPwd((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted hover:text-foreground"
                >
                  {showPwd ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="text-right">
              <button type="button" onClick={handleReset} className="text-sm text-muted hover:text-foreground">
                Forgot password?
              </button>
            </div>

            <Button type="submit" loading={loading} className="w-full">
              {loading ? 'Logging In…' : 'Log In'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="font-semibold text-success hover:underline">
              Sign Up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
