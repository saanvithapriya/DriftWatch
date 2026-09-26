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

**Phase 2** adds the repository architecture explorer: the ingested tree is
explored one directory at a time as a Mermaid `graph TD` diagram, alongside the
complete file tree.

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

## Phase 2 — Repository Architecture Explorer

Phase 2 turns the flat path list from Phase 1 into something explorable. It is
a purely deterministic frontend transformation — no new endpoint, and **no
extra request for any navigation**.

DriftWatch deliberately does **not** render the whole repository as one giant
graph. Large repositories contain thousands of files, so the visualization uses
hierarchical drill-down to keep diagrams readable and responsive:

```text
Repository
    ↓
High-level architecture      (top-level directories + root files)
    ↓
Directory drill-down         (click a directory)
    ↓
Deeper directory
    ↓
File tree for detailed inspection
```

### Why drill-down instead of one big diagram

Mermaid lays a graph out synchronously on the main thread, so an oversized
diagram does not merely render slowly — it freezes the tab. Measured in
Chromium on this project:

| Nodes | Render time |
| --- | --- |
| 100 | ~3.4s |
| 300 | ~15.3s |
| 500 | ~32.8s |
| 700 | never completes — Mermaid gives up |

Drawing one level at a time keeps every diagram far below that. `facebook/react`
(7,893 nodes) and `chromium/chromium` (57,053 nodes) both produce a root
diagram in well under half a second, because only their top-level entries are
drawn.

### Structure only — not a dependency graph

Phase 2 answers one question, and only that one:

```text
Phase 2:  "What files and directories exist?"
Phase 4:  "How does the code depend on and call other code?"
```

The diagram shows the file/folder hierarchy. It says nothing about imports or
call graphs; that analysis belongs to a later phase.

### The two views

**File Tree** (the default) holds the *complete* repository, with collapsible
directories. It is never reduced.

**Architecture** shows one directory at a time:

- The repository root shows top-level directories **and** root-level files
  (`package.json`, `README.md`, …) — root files are never hidden.
- Clicking a directory node drills into it and draws only *its* children.
- **Breadcrumbs** (`react/react / src / components`) jump to any ancestor.
- **↑ Up** goes one level up, and is disabled at the repository root.
- **Show files** (off by default) adds file children to the current level.
- **Depth** 1 or 2 draws one extra level when a quick overview helps.

Every directory node carries its size, so a directory's scale is visible
without opening it:

```text
📁 src
2 dirs · 5 files
```

Those counts are descendant totals, computed once when the hierarchy is built
rather than recalculated on each render.

### State and navigation

The repository tree is built once per analysis and never mutated. Navigation
changes only a `currentPath` string; the visible subtree is derived from it.
That makes navigation reversible and keeps stale state impossible — analyzing a
different repository resets the path to its root, and a path that no longer
exists falls back to the root rather than rendering nothing.

Because the whole tree is already in memory, **drilling down, breadcrumbs, Up,
and the toggles issue no network requests at all**. One analysis is exactly one
`POST /api/github/tree`.

### Generating a diagram

`buildFileTree` converts the flat `{ path, type }` list into a hierarchical
`TreeNode[]` with size metadata, creating any intermediate directories GitHub
did not list and ordering siblings directories-first then alphabetically, so
output is deterministic. `createRepositoryRoot` wraps that forest in a node
standing for the repository itself.

`generateMermaidDiagram(node, options)` is pure — it knows nothing about React
or HTTP — and emits a `graph TD` rooted at the selected directory:

```text
graph TD
  root(["src<br/>2 dirs · 5 files"])
  node_1("📁 components<br/>0 dirs · 2 files")
  root --> node_1
  node_2["📄 App.tsx"]
  root --> node_2
```

Node IDs are sequential (`node_1`, `node_2`, …) rather than derived from the
path. Deriving an ID by replacing unsafe characters is not injective:
`a-b.txt`, `a_b.txt` and `a.b.txt` all collapse onto the same ID, and files
silently vanish from the diagram. The generator also returns a map from node ID
back to repository path, which is what makes nodes clickable.

Labels are escaped with Mermaid entity codes (`#` first, then `&`, `"`, `<`,
`>`), so filenames such as `[id]`, `a"b.ts` or `a<b>c.ts` render as written
instead of breaking the syntax.

### Safety guard

Drawing one level at a time normally keeps diagrams small, but a single
directory can still hold hundreds of entries. `MAX_DIAGRAM_NODES` (150) caps
this: above it, nothing is generated and the view explains the situation
instead of freezing the browser.

```text
This directory contains 200 items, too many to render as one diagram
(the limit is 150). Use the File Tree, or select a subdirectory to
explore further.
```

### Truncated, empty, and failed diagrams

When Phase 1 reports `truncated: true`, the architecture view carries an
explicit warning that some files may be missing, so a partial tree is never
presented as the complete repository. Navigation still works over whatever
arrived.

An empty repository shows `This repository has no files to visualize.` rather
than an invalid diagram. If Mermaid fails to render, the page stays alive: the
user sees `Unable to render this diagram.` with a suggestion to try a smaller
directory, and the real error goes to the console.

## Frontend

The home page provides a repository URL field and an **Analyze Repository**
button. It shows a loading state while fetching, reports errors inline, and on
success displays the repository name, default branch, and file and directory
counts, followed by the two views described above.


## Testing

Frontend unit tests are plain TypeScript with no test-framework dependency:

```bash
npm test --workspace=frontend
```

This covers the tree builder and its size metadata, the Mermaid generator
(including ID collisions, escaping, the max-node guard and determinism), and
architecture-view navigation. The backend has its own suite for URL parsing and
GitHub error mapping:

```bash
npm test --workspace=backend
```
