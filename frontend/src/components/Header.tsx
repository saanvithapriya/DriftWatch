import { useEffect, useState } from "react";
import { getHealth } from "../services/api";

type HealthStatus = "checking" | "online" | "offline";

export function Header() {
  const [healthStatus, setHealthStatus] = useState<HealthStatus>("checking");

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then(() => { if (!cancelled) setHealthStatus("online"); })
      .catch(() => { if (!cancelled) setHealthStatus("offline"); });
    return () => { cancelled = true; };
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
          <span className={dotClass} aria-hidden="true" />
          <span className="site-header__status-label">{statusLabel}</span>
        </div>
      </div>
    </header>
  );
}
