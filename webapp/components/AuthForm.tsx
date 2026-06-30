'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

// Email/password auth against the real Firebase auth (window.FXAuth from the
// client bootstrap). Matches the app's dark UI. `mode` = 'login' | 'signup'.
export default function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const signup = mode === 'signup';
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  const FXAuth = () => (typeof window !== 'undefined' ? (window as any).FXAuth : null);

  const submit = async () => {
    if (busy) return;
    const fx = FXAuth();
    if (!fx) { setErr('Still loading — try again in a moment.'); return; }
    if (!email.trim() || !password) { setErr('Enter your email and password.'); return; }
    setErr(''); setNote(''); setBusy(true);
    try {
      let ref = '';
      try { ref = new URLSearchParams(window.location.search).get('ref') || ''; } catch {}
      if (signup) await fx.signUp({ firstName, lastName, email, password, ref });
      else await fx.signIn(email, password);
      // AuthRedirector in providers will route to the app once auth state flips.
      router.replace('/');
    } catch (e: any) {
      setErr(fx.mapError ? fx.mapError(e?.code, e?.message) : (e?.message || 'Something went wrong.'));
      setBusy(false);
    }
  };
  const reset = async () => {
    const fx = FXAuth();
    if (!email.trim()) { setErr('Enter your email above first.'); return; }
    setErr('');
    try { await fx.reset(email); setNote('Password reset email sent — check your inbox.'); }
    catch (e: any) { setErr(fx.mapError ? fx.mapError(e?.code, e?.message) : 'Could not send reset email.'); }
  };
  const google = async () => {
    if (busy) return;
    const fx = FXAuth();
    if (!fx || !fx.googleSignIn) { setErr('Still loading — try again in a moment.'); return; }
    setErr(''); setNote(''); setBusy(true);
    try { await fx.googleSignIn(); router.replace('/'); }
    catch (e: any) { setErr(fx.mapError ? fx.mapError(e?.code, e?.message) : (e?.message || 'Could not sign in with Google.')); setBusy(false); }
  };

  const field = (props: any) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'var(--surface, #12161C)', borderRadius: 13, padding: '14px 15px', boxShadow: 'inset 0 0 0 1px var(--line, #232932)', marginBottom: 11 }}>
      <input {...props} style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text, #E7ECF2)', fontSize: 15, fontFamily: 'inherit', minWidth: 0 }} />
    </div>
  );

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg, #0B0E11)', color: 'var(--text, #E7ECF2)', display: 'flex', flexDirection: 'column', padding: '0 24px', justifyContent: 'center' }}>
      <div style={{ maxWidth: 420, width: '100%', margin: '0 auto' }}>
        {/* Centered header with the FXcrypt mobile-app logo (Mark) */}
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <div style={{ width: 56, height: 56, margin: '0 auto 20px', filter: 'drop-shadow(0 10px 30px var(--glow, rgba(252,213,53,.35)))' }} aria-label="FXcrypt">
            <svg viewBox="0 0 32 32" width={56} height={56}>
              <rect x="2" y="2" width="28" height="28" rx="9" fill="var(--accent, #FCD535)" />
              <path d="M11 10h11M11 16h8M11 22V10" stroke="var(--on-accent, #0B0E11)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <circle cx="21.5" cy="21" r="2.4" fill="var(--on-accent, #0B0E11)" />
            </svg>
          </div>
          <div style={{ fontSize: 27, fontWeight: 800, letterSpacing: -0.6 }}>{signup ? 'Create your account' : 'Welcome back'}</div>
          <div style={{ fontSize: 14.5, color: 'var(--muted, #8A94A3)', marginTop: 5 }}>{signup ? 'Start trading in under a minute.' : 'Sign in to your command center.'}</div>
        </div>

        {signup && (
          <div style={{ display: 'flex', gap: 11 }}>
            <div style={{ flex: 1 }}>{field({ placeholder: 'First name', value: firstName, onChange: (e: any) => setFirstName(e.target.value) })}</div>
            <div style={{ flex: 1 }}>{field({ placeholder: 'Last name', value: lastName, onChange: (e: any) => setLastName(e.target.value) })}</div>
          </div>
        )}
        {field({ type: 'email', placeholder: 'Email address', value: email, autoComplete: 'email', onChange: (e: any) => setEmail(e.target.value) })}
        {field({ type: 'password', placeholder: 'Password', value: password, autoComplete: signup ? 'new-password' : 'current-password', onChange: (e: any) => setPassword(e.target.value), onKeyDown: (e: any) => { if (e.key === 'Enter') submit(); } })}

        {!signup && (
          <div style={{ textAlign: 'right', marginTop: -4, marginBottom: 8 }}>
            <button onClick={reset} style={{ background: 'none', border: 'none', color: 'var(--muted, #8A94A3)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Forgot password?</button>
          </div>
        )}
        {err && <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--down, #EF4444)', background: 'var(--down-bg, rgba(239,68,68,.12))', borderRadius: 11, padding: '11px 13px', fontWeight: 600 }}>{err}</div>}
        {note && <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--up, #22C55E)', background: 'rgba(34,197,94,.12)', borderRadius: 11, padding: '11px 13px', fontWeight: 600 }}>{note}</div>}

        <button onClick={submit} disabled={busy} style={{ width: '100%', background: 'var(--accent, #3B82F6)', color: 'var(--on-accent, #fff)', border: 'none', borderRadius: 13, padding: '15px', fontWeight: 800, fontSize: 15.5, cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1, marginTop: 6 }}>
          {busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--line, #232932)' }} />
          <span style={{ fontSize: 12.5, color: 'var(--faint, #5E6673)' }}>or</span>
          <div style={{ flex: 1, height: 1, background: 'var(--line, #232932)' }} />
        </div>
        <button onClick={google} disabled={busy} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'var(--surface, #12161C)', color: 'var(--text, #E7ECF2)', border: 'none', boxShadow: 'inset 0 0 0 1px var(--line, #232932)', borderRadius: 13, padding: '14px', fontWeight: 700, fontSize: 14.5, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"/></svg>
          Continue with Google
        </button>

        <div style={{ textAlign: 'center', fontSize: 13.5, color: 'var(--muted, #8A94A3)', marginTop: 20 }}>
          {signup ? 'Already have an account? ' : 'New to FXcrypt? '}
          <a href={signup ? '/login' : '/signup'} style={{ color: 'var(--accent, #3B82F6)', fontWeight: 700 }}>{signup ? 'Sign in' : 'Create one'}</a>
        </div>
      </div>
    </div>
  );
}
