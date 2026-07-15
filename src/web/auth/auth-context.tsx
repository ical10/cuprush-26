import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { clearToken, getToken, setToken as persistToken } from "../lib/auth-storage";

export type AuthMode = "dev" | "privy";

export function authMode(): AuthMode {
  const raw = (import.meta.env.VITE_AUTH_MODE as string | undefined) ?? "dev";
  return raw === "privy" ? "privy" : "dev";
}

export type AuthContextValue = {
  isAuthenticated: boolean;
  login(token: string): void;
  logout(): void;
};

// Exported so the Privy bridge (privy-provider.tsx) can supply the same
// context shape from Privy's session instead of a localStorage token.
export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken());

  const login = useCallback((newToken: string) => {
    persistToken(newToken);
    setTokenState(newToken);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ isAuthenticated: token !== null, login, logout }),
    [token, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
