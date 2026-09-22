/**
 * Cheap client-side check so obviously wrong input never reaches the API.
 * The backend remains the source of truth for validation.
 */
export function isLikelyGithubRepositoryUrl(input: string): boolean {
  return /^(https?:\/\/)?(www\.)?github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/?$/i.test(
    input.trim()
  );
}
