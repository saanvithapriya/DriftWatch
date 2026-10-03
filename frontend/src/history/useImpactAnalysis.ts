import { analyzeImpact } from "../services/api";
import { useOnDemandResource } from "./useOnDemandResource";
import type { ImpactAnalysis } from "../types/history";

/** Runs static impact analysis between two refs, keyed by (base, head, depth). */
export function useImpactAnalysis(repositoryUrl: string, analysisId: number) {
  const resource = useOnDemandResource<ImpactAnalysis>();

  function analyze(base: string, head: string, maxDepth: number): void {
    resource.run(`${analysisId}::${repositoryUrl}::${base}...${head}::${maxDepth}`, () =>
      analyzeImpact(repositoryUrl, base, head, maxDepth)
    );
  }

  return { ...resource, analyze };
}
