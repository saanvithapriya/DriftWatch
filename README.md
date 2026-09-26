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

**Phase 1** added GitHub repository ingestion: a public repository URL in, a
normalized file tree out. See below.

**Phase 2** adds the repository visualizer: the ingested tree is rendered as a
Mermaid `graph TD` diagram alongside the existing file tree.

Code intelligence, dependency analysis, private repositories, and persistence
do not exist yet — those belong to later phases.

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

## Phase 2 — Repository Visualizer

Phase 2 turns the flat path list from Phase 1 into a diagram. It is a purely
deterministic frontend transformation — no new endpoint, no extra request.

```text
GitHub repository
      ↓
Recursive file tree          (Phase 1: POST /api/github/tree)
      ↓
Hierarchical tree            (buildFileTree)
      ↓
Mermaid graph TD             (generateMermaidDiagram)
      ↓
Repository structure visualization
```

### Structure only — not a dependency graph

Phase 2 answers one question, and only that one:

```text
Phase 2:  "What files and directories exist?"
Phase 4:  "How does the code depend on and call other code?"
```

The diagram shows the file/folder hierarchy. It says nothing about imports,
call graphs, or any relationship between the contents of two files. That
analysis belongs to a later phase.

### How the diagram is built

`buildFileTree` converts the flat `{ path, type }` list into a hierarchical
`TreeNode[]`, creating any intermediate directories GitHub did not list and
ordering siblings directories-first then alphabetically, so the output is
deterministic.

`generateMermaidDiagram` then walks that tree and emits a `graph TD` rooted at
a node for the repository itself:

```text
graph TD
  root(["octocat/Hello-World"])
  node_1("📁 src")
  root --> node_1
  node_2["📄 App.tsx"]
  node_1 --> node_2
```

Node IDs are sequential (`node_1`, `node_2`, …) rather than derived from the
path. Deriving an ID by replacing unsafe characters is not injective:
`a-b.txt`, `a_b.txt` and `a.b.txt` all collapse onto the same ID, and files
silently vanish from the diagram. Allocation follows the tree's deterministic
order, so IDs stay stable between runs.

Labels are escaped with Mermaid entity codes (`#` first, then `&`, `"`, `<`,
`>`), so filenames such as `[id]`, `a"b.ts` or `a<b>c.ts` render as written
instead of breaking the syntax.

### Large repositories

Mermaid lays a graph out synchronously on the main thread, so an unbounded
diagram does not just render slowly — it freezes the tab. Measured in Chromium
on this project:

| Nodes | Render time |
| --- | --- |
| 100 | ~3.4s |
| 300 | ~15.3s |
| 500 | ~32.8s |
| 700 | never completes — Mermaid gives up |

So `utils/diagramPlan.ts` picks the most detailed view that still fits:

- **≤ 150 nodes** — rendered immediately.
- **151–500 nodes** — rendered only after the user confirms, with the cost
  stated up front.
- **> 500 nodes** — the view is reduced: first to directories only, then by
  capping depth, until it fits. The UI says which reduction was applied.

A **Directories only** toggle is available for any repository. The File Tree
view is never reduced and always shows the complete structure.

### Truncated and empty repositories

When Phase 1 reports `truncated: true`, the diagram view carries an explicit
warning that it may not contain every file, so a partial tree is never
presented as complete. An empty repository shows
`Repository has no files to visualize.` rather than an invalid diagram.

If Mermaid fails to parse or render, the page does not crash: the user sees
`Unable to render repository diagram.` and the real error is logged to the
console for debugging.

## Frontend

The home page provides a repository URL field and an **Analyze Repository**
button. It shows a loading state while fetching, reports errors inline, and on
success displays the repository name, default branch, and file and directory
counts.

Below that, a view switch selects how to explore the structure:

```text
[ File Tree ] [ Diagram ]
```

**File Tree** (the default) is the Phase 1 collapsible tree: top-level entries
are expanded and nested directories start collapsed, so large repositories stay
responsive. **Diagram** is the Phase 2 Mermaid visualization. Mermaid does no
work until the Diagram tab is selected.

## Testing

Frontend unit tests are plain TypeScript with no test-framework dependency:

```bash
npm test --workspace=frontend
```

This covers the tree builder, the Mermaid generator (including ID collisions,
escaping and determinism), and the large-repository planner.
