import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Backend, MyProfile } from '../backend/types';

interface Ctx {
  backend: Backend;
  profile: MyProfile | null;
  signedIn: boolean;
  loading: boolean;
  refreshProfile(): Promise<void>;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ backend, children }: { backend: Backend; children: React.ReactNode }) {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const refreshProfile = useCallback(async () => {
    const ok = await backend.isSignedIn();
    setSignedIn(ok);
    setProfile(ok ? await backend.getProfile() : null);
    setLoading(false);
  }, [backend]);
  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);
  const value = useMemo(() => ({ backend, profile, signedIn, loading, refreshProfile }), [backend, profile, signedIn, loading, refreshProfile]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppProvider missing');
  return c;
}
