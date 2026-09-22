import { useState, type FormEvent } from "react";
import { analyzeGithubRepository } from "../services/api";
import type { RepositoryTree } from "../types/github";
import { isLikelyGithubRepositoryUrl } from "../utils/githubUrl";
import { FileTree } from "./FileTree";

type Status = "idle" | "loading" | "success" | "error";

function countNodes(tree: RepositoryTree): { files: number; directories: number } {
  let files = 0;
  let directories = 0;

  for (const node of tree.tree) {
    if (node.type === "file") files += 1;
    else directories += 1;
  }

  return { files, directories };
}

export function RepositoryAnalyzer() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<RepositoryTree | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = url.trim();

    // Basic client-side checks only; the backend validates authoritatively.
    if (trimmed === "") {
      setStatus("error");
      setResult(null);
      setError("Please enter a GitHub repository URL.");
      return;
    }

    if (!isLikelyGithubRepositoryUrl(trimmed)) {
      setStatus("error");
      setResult(null);
      setError(
        "Enter a repository URL in the form https://github.com/owner/repository"
      );
      return;
    }

    setStatus("loading");
    setError(null);
    setResult(null);

    try {
      const data = await analyzeGithubRepository(trimmed);
      setResult(data);
      setStatus("success");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Failed to fetch GitHub repository"
      );
      setStatus("error");
    }
  }

  const counts = result === null ? null : countNodes(result);

  return (
    <section>
      <h2>Analyze GitHub Repository</h2>

      <form onSubmit={handleSubmit}>
        <label htmlFor="repository-url">Repository URL</label>{" "}
        <input
          id="repository-url"
          type="text"
          value={url}
          placeholder="https://github.com/owner/repository"
          size={40}
          onChange={(event) => setUrl(event.target.value)}
        />{" "}
        <button type="submit" disabled={status === "loading"}>
          {status === "loading" ? "Analyzing..." : "Analyze Repository"}
        </button>
      </form>

      {status === "loading" && <p>Fetching repository...</p>}

      {status === "error" && error !== null && (
        <p role="alert">{error}</p>
      )}

      {status === "success" && result !== null && counts !== null && (
        <div>
          <h3>
            Repository: {result.repository.owner}/{result.repository.name}
          </h3>
          <p>Default branch: {result.repository.defaultBranch}</p>
          <p>
            Files: {counts.files} &middot; Directories: {counts.directories}
          </p>

          {result.truncated && (
            <p role="alert">
              This repository is too large for GitHub to return in one
              response, so the tree below is incomplete.
            </p>
          )}

          <FileTree nodes={result.tree} />
        </div>
      )}
    </section>
  );
}
