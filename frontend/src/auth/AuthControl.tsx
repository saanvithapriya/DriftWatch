import { githubConnectUrl } from "./authApi";
import { useAuth } from "./AuthContext";

/**
 * Minimal sign-in control for the header. Additive only: it does not touch
 * the analyzer, file tree or diagram.
 */
export function AuthControl() {
  const { user, status, disconnect } = useAuth();

  if (status === "loading") {
    return <span className="auth-control__pending">Checking sign-in…</span>;
  }

  if (user === null) {
    return (
      <a className="btn btn-primary auth-control__connect" href={githubConnectUrl()}>
        Connect GitHub
      </a>
    );
  }

  return (
    <div className="auth-control">
      <img
        className="auth-control__avatar"
        src={user.avatarUrl}
        alt=""
        width={24}
        height={24}
      />
      <span className="auth-control__login">{user.login}</span>
      <button type="button" className="btn-ghost" onClick={() => void disconnect()}>
        Disconnect
      </button>
    </div>
  );
}
