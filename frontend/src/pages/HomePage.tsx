import { Header } from "../components/Header";
import { RepositoryAnalyzer } from "../components/RepositoryAnalyzer";

export function HomePage() {
  return (
    <div className="page-shell">
      <Header />

      <main className="page-main">
        <div className="page-content">
          {/* Hero */}
          <div className="hero">
            <h1 className="hero__title">Repository Intelligence</h1>
            <p className="hero__desc">
              Understand your repository structure at a glance.
            </p>
          </div>

          {/* Analyzer + results */}
          <RepositoryAnalyzer />
        </div>
      </main>

      <footer className="page-footer">
        <p className="page-footer__text">DriftWatch · Repository Intelligence Platform</p>
      </footer>
    </div>
  );
}
