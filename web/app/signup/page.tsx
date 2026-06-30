'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { Logo } from '@/components/Logo';
import { Button, Input, Label } from '@/components/ui';

export default function SignupPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  const handleSignup = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: `${firstName} ${lastName}`.trim() });
      await setDoc(doc(db, 'users', cred.user.uid), {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        createdAt: new Date().toISOString()
      });
      router.replace('/pointer');
    } catch (err: any) {
      const text =
        err.code === 'auth/email-already-in-use'
          ? 'An account with that email already exists.'
          : err.code === 'auth/weak-password'
          ? 'Password should be at least 6 characters.'
          : err.code === 'auth/invalid-email'
          ? 'Please enter a valid email address.'
          : err.message;
      setMsg({ text, error: true });
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-8 flex justify-center">
          <Logo size={48} />
        </div>
        <div className="card p-7">
          <h2 className="text-center text-2xl font-bold">Create Account</h2>
          <p className="mb-6 mt-1 text-center text-sm text-muted">Join FXcrypt to track and trade on-chain.</p>

          {msg && (
            <div className={`mb-5 rounded-xl px-4 py-3 text-center text-sm font-medium ${msg.error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}>
              {msg.text}
            </div>
          )}

          <form onSubmit={handleSignup} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="fn">First Name</Label>
                <Input id="fn" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="ln">Last Name</Label>
                <Input id="ln" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="email">Email Address</Label>
              <Input id="email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="pw">Password</Label>
              <Input id="pw" type="password" required autoComplete="new-password" placeholder="At least 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" loading={loading} className="w-full">
              {loading ? 'Creating…' : 'Sign Up'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            Already have an account?{' '}
            <Link href="/login" className="font-bold text-brand hover:underline">
              Log In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
