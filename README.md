# Repository Intelligence Platform

This project will eventually provide GitHub repository analysis, architecture visualization, code intelligence, and developer onboarding capabilities.

## Current Phase

**Phase 0** established the foundational full-stack setup:

- Express + TypeScript backend
- Vite + React + TypeScript frontend
- Development hot reload for both frontend and backend
- Environment variable configuration
- CORS configured for local development
- A backend health API endpoint
- Frontend/backend round trip verification

**Phase 1** adds GitHub repository ingestion: a public repository URL in, a
normalized file tree out. See below.

Architecture visualization, code intelligence, private repositories, and
persistence do not exist yet — those belong to later phases.

## Project Structure

```text
backend/    Express + TypeScript API server
frontend/   Vite + React + TypeScript client
```

## Running Locally

Install dependencies for both workspaces from the repo root:

```bash
npm install
```

Copy the environment file examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Start both frontend and backend together:

```bash
npm run dev
```

- Backend: http://localhost:5000
- Frontend: http://localhost:5173

Or run them independently:

```bash
npm run dev:backend
npm run dev:frontend
```

## Phase 1 — GitHub Repository Ingestion

The backend accepts a public GitHub repository URL and returns the
repository's file tree, normalized into application-level types.

```text
Public GitHub repository URL
        ↓
Octokit
        ↓
Repository metadata
        ↓
Default branch
        ↓
Recursive Git tree
        ↓
Normalized repository tree
```

The default branch is read from the repository metadata rather than assumed to
be `main` or `master`, and the tree is requested recursively so nested
directories are included in a single call.

Only public repositories are supported. No GitHub token is required; setting
the optional `GITHUB_TOKEN` in `backend/.env` only raises the GitHub API rate
limit (60 requests per hour when unauthenticated).

### Backend layout

```text
backend/src/
├── config/octokit.ts          Octokit client factory
├── controllers/githubController.ts
├── routes/githubRoutes.ts
├── services/githubService.ts   GitHub calls + normalization
├── types/github.ts             Domain types
└── utils/githubUrl.ts          Repository URL parsing
```

## API

### `GET /api/health`

Returns:

```json
{
  "success": true,
  "message": "Backend is running"
}
```

### `POST /api/github/tree`

Request:

```json
{
  "url": "https://github.com/octocat/Hello-World"
}
```

Accepted URL forms — `https://github.com/<owner>/<repo>`, with an optional
trailing slash, an optional `.git` suffix, an optional `www.`, and an optional
scheme. Deeper paths such as `/owner/repo/tree/main` are rejected for now.

Response:

```json
{
  "success": true,
  "data": {
    "repository": {
      "owner": "octocat",
      "name": "Hello-World",
      "defaultBranch": "master"
    },
    "tree": [
      { "path": "README", "type": "file" },
      { "path": "src", "type": "directory" },
      { "path": "src/index.js", "type": "file" }
    ],
    "truncated": false
  }
}
```

GitHub's `blob` entries become `file` and `tree` entries become `directory`.
Submodule entries are omitted. Raw Octokit fields are never exposed.

`truncated` is `true` when the repository is too large for GitHub to return in
one response; the tree is then incomplete, and the frontend says so rather
than presenting a partial tree as the whole repository.

#### Errors

| Status | Message | Cause |
| --- | --- | --- |
| 400 | `Invalid GitHub repository URL` | Missing, malformed, or non-GitHub URL |
| 404 | `GitHub repository not found` | Repository does not exist or is private |
| 429 | `GitHub API rate limit exceeded. Please try again later.` | GitHub rate limit hit |
| 502 | `Failed to fetch GitHub repository` | Any other GitHub API failure |

Errors always take the shape `{ "success": false, "message": "..." }`. Stack
traces and raw Octokit errors are never returned to the client.

## Frontend

The home page provides a repository URL field and an **Analyze Repository**
button. It shows a loading state while fetching, reports errors inline, and on
success displays the repository name, default branch, file and directory
counts, and a collapsible nested file tree.

Top-level entries are expanded by default and nested directories start
collapsed, so large repositories stay responsive.
