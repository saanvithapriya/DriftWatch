import { useEffect, useState } from "react";
import { AuthControl } from "../auth/AuthControl";
import { getHealth } from "../services/api";

type HealthStatus = "checking" | "online" | "offline";

const HEALTH_POLL_INTERVAL_MS = 10_000;

export function Header() {
  const [healthStatus, setHealthStatus] = useState<HealthStatus>("checking");

  useEffect(() => {
    let cancelled = false;

    // Re-checked rather than probed once: a single check on mount leaves the
    // badge stuck on "Backend Offline" for the rest of the session if the
    // backend happened to be starting, and it never notices a backend that
    // goes away later.
    function check(): void {
      getHealth()
        .then(() => {
          if (!cancelled) setHealthStatus("online");
        })
        .catch(() => {
          if (!cancelled) setHealthStatus("offline");
        });
    }

    check();

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") check();
    }, HEALTH_POLL_INTERVAL_MS);
    window.addEventListener("focus", check);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, []);

  const dotClass = `status-dot ${healthStatus}`;

  const statusLabel =
    healthStatus === "checking"
      ? "Checking..."
      : healthStatus === "online"
      ? "Backend Ready"
      : "Backend Offline";

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <div className="site-header__brand">
          <span className="site-header__logo">DriftWatch</span>
          <span className="site-header__tagline">Repository Intelligence Platform</span>
        </div>
        <div className="site-header__status">
          <AuthControl />
          <span className={dotClass} aria-hidden="true" />
          <span className="site-header__status-label">{statusLabel}</span>
        </div>
      </div>
    </header>
  );
}
