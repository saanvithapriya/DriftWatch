import { fetchFileHistory } from "../services/api";
import { useOnDemandResource } from "./useOnDemandResource";
import type { FileHistory } from "../types/history";

/** Loads one file's commit history, keyed by path — e.g. clicking a hotspot. */
export function useFileHistory(repositoryUrl: string, analysisId: number) {
  const resource = useOnDemandResource<FileHistory>();

  function load(path: string): void {
    resource.run(`${analysisId}::${repositoryUrl}::${path}`, () =>
      fetchFileHistory(repositoryUrl, path)
    );
  }

  return { ...resource, load };
}
