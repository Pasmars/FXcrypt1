'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, signOut as fbSignOut, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@shared/lib/firebase';

export interface Profile {
  firstName?: string;
  lastName?: string;
  [k: string]: unknown;
}

interface AuthState {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  initials: string;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  profile: null,
  loading: true,
  initials: '',
  signOut: async () => {}
});

function computeInitials(user: User | null, profile: Profile | null): string {
  if (profile?.firstName || profile?.lastName) {
    return ((profile.firstName?.[0] || '') + (profile.lastName?.[0] || '')).toUpperCase();
  }
  if (user?.displayName) {
    const parts = user.displayName.split(' ');
    const f = parts[0]?.[0] || '';
    const l = parts.length > 1 ? parts[parts.length - 1][0] : '';
    const di = (f + l).toUpperCase();
    if (di) return di;
  }
  return user?.email?.[0]?.toUpperCase() || '';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const snap = await getDoc(doc(db, 'users', u.uid));
          setProfile(snap.exists() ? (snap.data() as Profile) : null);
        } catch {
          setProfile(null);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const value: AuthState = {
    user,
    profile,
    loading,
    initials: computeInitials(user, profile),
    signOut: () => fbSignOut(auth)
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
