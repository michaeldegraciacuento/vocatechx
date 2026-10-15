import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type SessionUser } from "../lib/api";
import { AuthContext, type AuthContextValue } from "./context";

/** Mirrors the backend session. The backend is the source of truth; this only decides which screen to show. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      setUser(await api.getSession());
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    api
      .getSession()
      .then(setUser, () => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      refreshSession,
      login: async (username, password) => {
        setUser(await api.login(username, password));
      },
      logout: async () => {
        try {
          await api.logout();
        } finally {
          setUser(null);
        }
      },
      changePassword: async (currentPassword, newPassword, confirmPassword) => {
        setUser(await api.changePassword(currentPassword, newPassword, confirmPassword));
      },
    }),
    [user, loading, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
