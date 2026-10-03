import { fetchCommitDetail } from "../services/api";
import { useOnDemandResource } from "./useOnDemandResource";
import type { CommitDetail } from "../types/history";

/** Loads one commit's full detail, keyed by sha — selecting a different
 *  commit never refetches the whole history, only this one commit. */
export function useCommitDetail(repositoryUrl: string, analysisId: number) {
  const resource = useOnDemandResource<CommitDetail>();

  function select(sha: string): void {
    resource.run(`${analysisId}::${repositoryUrl}::${sha}`, () =>
      fetchCommitDetail(repositoryUrl, sha)
    );
  }

  return { ...resource, select };
}
