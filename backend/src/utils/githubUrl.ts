import { AppError } from "./appError.js";

export interface ParsedRepositoryUrl {
  owner: string;
  repo: string;
}

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

// GitHub owner names allow alphanumerics and hyphens; repository names also
// allow dots and underscores.
const OWNER_PATTERN = /^[A-Za-z0-9-]+$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Parses `https://github.com/<owner>/<repo>` into its owner and repository.
 *
 * Tolerated variations: a missing scheme, a `www.` host, a trailing slash, a
 * trailing `.git`, and a query string or fragment. Anything else — another
 * host, a missing segment, or a deeper path such as `/owner/repo/tree/main` —
 * returns `null`. Broader URL shapes are intentionally out of scope for now.
 */
export function parseGithubRepositoryUrl(
  input: string
): ParsedRepositoryUrl | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) return null;

  // Embedded credentials (`https://user:pass@github.com/...`) are a phishing
  // pattern and never appear in a real repository URL. The host is genuinely
  // github.com here, so this is rejected for hygiene rather than necessity.
  if (url.username !== "" || url.password !== "") return null;

  // A non-default port is not the public GitHub service, whatever the host
  // says. `url.port` is empty for the scheme's default port.
  if (url.port !== "") return null;

  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  if (segments.length !== 2) return null;

  const [owner, rawRepo] = segments;
  const repo = rawRepo.replace(/\.git$/i, "");

  if (!OWNER_PATTERN.test(owner)) return null;
  if (!REPO_PATTERN.test(repo)) return null;
  if (repo === "." || repo === "..") return null;

  return { owner, repo };
}

/**
 * Same as `parseGithubRepositoryUrl` but raises the 400 the API returns for a
 * URL it cannot understand.
 */
export function parseGithubRepositoryUrlOrThrow(
  input: unknown
): ParsedRepositoryUrl {
  if (typeof input !== "string") {
    throw new AppError(400, "Invalid GitHub repository URL");
  }

  const parsed = parseGithubRepositoryUrl(input);
  if (parsed === null) {
    throw new AppError(400, "Invalid GitHub repository URL");
  }

  return parsed;
}
