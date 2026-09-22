import { BackendStatus } from "../components/BackendStatus";
import { RepositoryAnalyzer } from "../components/RepositoryAnalyzer";

export function HomePage() {
  return (
    <main>
      <h1>Repository Intelligence Platform</h1>
      <h2>Backend Status</h2>
      <BackendStatus />
      <RepositoryAnalyzer />
    </main>
  );
}
