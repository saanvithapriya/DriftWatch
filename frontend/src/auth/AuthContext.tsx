import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchCurrentUser, signOut, type AuthUser } from "./authApi";

type AuthStatus = "loading" | "ready";

interface AuthState {
  user: AuthUser | null;
  status: AuthStatus;
  /** True when the browser came back from a failed authorization attempt. */
  failed: boolean;
  refresh: () => Promise<void>;
  disconnect: () => Promise<void>;
  dismissFailure: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Reads the `?auth=connected|error` marker the backend adds when redirecting
 * the browser back, then strips it so a refresh does not replay it.
 */
function consumeAuthRedirectMarker(): "connected" | "error" | null {
  if (typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const marker = url.searchParams.get("auth");
  if (marker !== "connected" && marker !== "error") return null;

  url.searchParams.delete("auth");
  window.history.replaceState({}, "", url.toString());
  return marker;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setUser(await fetchCurrentUser());
    } catch {
      // A backend that cannot be reached simply means "signed out" here; the
      // header already reports backend availability separately.
      setUser(null);
    } finally {
      setStatus("ready");
    }
  }, []);

  useEffect(() => {
    if (consumeAuthRedirectMarker() === "error") setFailed(true);
    void refresh();
  }, [refresh]);

  const disconnect = useCallback(async () => {
    try {
      await signOut();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      status,
      failed,
      refresh,
      disconnect,
      dismissFailure: () => setFailed(false),
    }),
    [user, status, failed, refresh, disconnect]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return context;
}
