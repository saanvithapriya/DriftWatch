import { fetchHistoryStats } from "../services/api";
import type { HistoryQueryParams } from "../services/api";
import { useOnDemandResource } from "./useOnDemandResource";
import type { HistoryStats } from "../types/history";

/**
 * Loads change hotspots and contributor activity for the current history
 * query. Noticeably more expensive than the plain commit list (the backend
 * inspects each commit individually), so this only ever runs when the user
 * opens the Change Hotspots or Contributors section — never automatically.
 */
export function useHistoryStats(repositoryUrl: string, analysisId: number) {
  const resource = useOnDemandResource<HistoryStats>();

  function load(query: HistoryQueryParams): void {
    resource.run(`${analysisId}::${repositoryUrl}::${JSON.stringify(query)}`, () =>
      fetchHistoryStats(repositoryUrl, query)
    );
  }

  return { ...resource, load };
}
