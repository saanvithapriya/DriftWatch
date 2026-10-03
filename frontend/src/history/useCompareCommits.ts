import { compareCommits } from "../services/api";
import { useOnDemandResource } from "./useOnDemandResource";
import type { CommitComparison } from "../types/history";

/** Compares two refs, keyed by the pair — only runs when the user clicks Compare. */
export function useCompareCommits(repositoryUrl: string, analysisId: number) {
  const resource = useOnDemandResource<CommitComparison>();

  function compare(base: string, head: string): void {
    resource.run(`${analysisId}::${repositoryUrl}::${base}...${head}`, () =>
      compareCommits(repositoryUrl, base, head)
    );
  }

  return { ...resource, compare };
}
