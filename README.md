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

**Phase 3** adds GitHub App sign-in so private repositories you have access to
can be analyzed too. Anonymous public analysis is unchanged, and the GitHub
credential never reaches the browser.

**Phase 4** adds code parsing: Tree-sitter reads the repository's JavaScript
and TypeScript and builds an interactive React Flow graph of which source
files import which.

**Phase 5** adds CI/CD: GitHub Actions workflows are parsed and drawn as job
dependency graphs, with each job's steps alongside. Workflows are analyzed
statically and never executed.

Function call graphs, Git history and persistence do not exist yet — those
belong to later phases.

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

## Phase 3 — Private Repository Support

Phase 3 lets a signed-in user analyze private repositories, while leaving
anonymous public analysis exactly as it was.

```text
GitHub URL
    ↓
POST /api/github/tree          (unchanged contract)
    ↓
Auth/session middleware        (resolves a credential, or not)
    ↓
Controller                     (knows about identity)
    ↓
githubService(owner, repo, credential?)   (knows nothing about identity)
    ↓
Authenticated Octokit  OR  anonymous Octokit
    ↓
GitHub
```

**The GitHub credential never reaches the browser.** It is created by the
backend, stored in a server-side session, and used only for outbound GitHub
calls. The browser receives an opaque session id in an HttpOnly cookie and, at
most, the signed-in user's public profile (`id`, `login`, `name`, `avatarUrl`).

### Why a GitHub App

DriftWatch uses a **GitHub App** rather than an OAuth App. An OAuth App would
ask for an account-wide `repo` scope; a GitHub App is limited to the
repositories it is installed on and to the permissions it declares, which is
the least privilege that still answers "what files does this repository
contain?".

Only the **user authorization (user-to-server)** flow is used. The app's
private key and App ID exist solely for server-to-server installation tokens,
which DriftWatch never mints — so the private key is not configuration here and
never exists in the process at all.

### GitHub App setup

Create a GitHub App under *Settings → Developer settings → GitHub Apps*:

| Setting | Value |
| --- | --- |
| Callback URL | `http://localhost:5000/api/auth/github/callback` |
| Request user authorization (OAuth) during installation | enabled |
| Webhook | not required — disable it |
| Repository permissions → **Contents** | Read-only |
| Repository permissions → **Metadata** | Read-only (mandatory) |

`Contents: Read-only` is what allows the repository tree to be read; no write
permission of any kind is requested.

Then install the app on the account or organization whose repositories you want
to analyze, and set in `backend/.env`:

```bash
GITHUB_APP_CLIENT_ID=Iv1.xxxxxxxxxxxx
GITHUB_APP_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_APP_CALLBACK_URL=http://localhost:5000/api/auth/github/callback

# Only when the backend is served over HTTPS
# SESSION_COOKIE_SECURE=true
```

Leave them unset to run anonymously: public analysis still works and the
sign-in route reports that it is unavailable. `.env` is never committed.

### Authentication flow

```text
Browser clicks "Connect GitHub"
    ↓
GET /api/auth/github          → issues a random single-use state, redirects
    ↓
GitHub authorization / installation
    ↓
GET /api/auth/github/callback → requires + consumes the state, exchanges the
                                code, reads the user, creates a session
    ↓
Set-Cookie: HttpOnly session id
    ↓
Redirect to the configured frontend origin only
```

The callback is protected against CSRF: the `state` is 32 random bytes, stored
server-side, required on return, valid once, and expires after 10 minutes. The
code is never exchanged if the state does not validate. The redirect target is
always built from `FRONTEND_URL`, never from anything the browser supplies, so
there is no open-redirect surface.

### API endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/auth/github` | Starts authorization (503 if no app is configured) |
| `GET /api/auth/github/callback` | Validates state, creates the session |
| `GET /api/auth/me` | Safe profile, or `{ user: null }` |
| `GET /api/auth/logout` | Destroys the session, revokes the token, clears the cookie |

`POST /api/github/tree` is **unchanged** — same URL, same request body, same
response contract. It simply uses the session's credential when one exists.
A client cannot supply its own credential; the request body is never a source
of authentication.

### Session architecture

Sessions live behind a `SessionStore` interface with an in-memory
implementation. They hold the credential; the cookie holds only the opaque id.

> **In-memory sessions are not production-ready.** They are lost on restart and
> are not shared between processes, so a multi-instance deployment would sign
> users out at random as requests land on different instances. The interface
> exists so this can be replaced with Redis or a database without touching the
> auth flow.

### Security model

- The credential is stored server-side only, never in `localStorage`,
  `sessionStorage`, React state, a URL or a response body.
- The session cookie is `HttpOnly` (unreadable by page JavaScript),
  `SameSite=Lax`, `Path=/`, and `Secure` when `SESSION_COOKIE_SECURE=true`.
- CORS names exactly one origin with `credentials: true` — never a wildcard,
  which browsers reject alongside credentials anyway.
- Errors are logged through a redactor that strips GitHub token patterns and
  private-key blocks, and never serializes the error object, because Octokit
  errors carry the originating request's headers.
- Repository filenames remain escaped and are rendered as text, as in Phase 2.

### Private repository behaviour

| Caller | Repository | Result |
| --- | --- | --- |
| Anonymous | Public | Works |
| Signed in | Public | Works |
| Signed in, has access | Private | Works |
| Anonymous | Private | `404 GitHub repository not found` |
| Signed in, no access | Private | `404 GitHub repository not found` |

GitHub deliberately answers 404 rather than 403 for private repositories the
caller cannot see, so that their existence is not leaked. DriftWatch relays
that unchanged. The UI adds a **conditional** hint ("If it is private, connect
GitHub…") which never confirms that the repository exists.

If GitHub rejects a stored credential, the session is invalidated, the cookie
is cleared and the frontend returns to its signed-out state.

### Production hardening still required

1. Replace the in-memory session and state stores with a shared backing store.
2. Serve over HTTPS and set `SESSION_COOKIE_SECURE=true`.
3. Handle GitHub App user-token expiry/refresh if the app has expiring tokens
   enabled (currently a rejected token simply ends the session).
4. Make logout a `POST` with CSRF protection; it is a `GET` today.
5. Add rate limiting to the auth routes.
6. Rotate the client secret through a secret manager rather than `.env`.

## Phase 4 — Code Parsing and Dependency Graph

Phase 4 parses the repository's JavaScript and TypeScript with Tree-sitter and
draws which source files import which, as an interactive React Flow graph.

> **Phase 4 analyzes file/module dependencies. It does not analyze function
> calls.** The graph answers "which file imports which file?", not "which
> function calls which function". Call graphs belong to a later phase.

```text
GitHub repository
      ↓
Repository tree                    (Phase 1)
      ↓
Supported source files             .js .jsx .ts .tsx
      ↓
Source contents                    one archive download
      ↓
Tree-sitter                        parse per grammar
      ↓
Import extraction                  module specifiers
      ↓
Dependency resolution              against the repository tree
      ↓
Deterministic graph
      ↓
React Flow                         interactive explorer
```

This sits **alongside** the Phase 2 Mermaid architecture explorer, which is
unchanged. The application now has three views: **File Tree** (every file),
**Architecture** (Mermaid hierarchy, drill-down), and **Dependencies** (React
Flow import graph).

### Supported languages

| Extension | Grammar |
| --- | --- |
| `.js` | JavaScript |
| `.jsx` | JavaScript (covers JSX) |
| `.ts` | TypeScript |
| `.tsx` | TSX |

Any other extension is skipped, never parsed as JavaScript. A Python or Go
file is simply not analyzed.

### Supported import syntax

```js
import foo from "./foo";              // default
import { foo } from "./foo";          // named
import { foo as bar } from "./foo";   // aliased
import * as utils from "./utils";     // namespace
import type { User } from "./types";  // type-only
import "./styles.css";                // side effect
import("./lazy");                     // dynamic
require("./foo");                     // CommonJS
export { foo } from "./foo";          // re-export
export * from "./foo";                // star re-export
export * as ns from "./foo";          // namespace re-export
```

A specifier that is not a string literal — `require(someVariable)` — is not a
static dependency and is deliberately ignored rather than guessed at.

### Internal resolution

Relative specifiers are resolved against **the GitHub repository tree**, never
the local filesystem, and a target file is never invented. Candidates are
tried in this fixed order, so resolution is deterministic when more than one
could match:

```text
./foo  →  foo            (exact)
          foo.ts  foo.tsx  foo.js  foo.jsx
          foo/index.ts  foo/index.tsx  foo/index.js  foo/index.jsx
```

`../` and `../../` are supported. Paths are normalized to POSIX form, and
resolution **cannot escape the repository root** — `../../../etc/passwd`
resolves to nothing regardless of what exists.

### External and unresolved imports

A bare specifier (`react`, `lodash/merge`, `@scope/pkg`) is classified
**external** and never becomes a repository node; only a count is kept. This
holds even if a file of the same name exists, so `import "react"` never
attaches to a local `react.ts`.

A specifier that looked like a repository path but matched no file is
**unresolved** and is counted, not guessed.

### Path aliases

Aliases are read from `tsconfig.json` or `jsconfig.json`, but only in the
unambiguous single-target wildcard form:

```json
{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }
```

A mapping with several targets, or without a trailing `/*`, is skipped — the
import is reported unresolved rather than attached to a guessed file. Relative
imports never depend on alias support.

### Source acquisition

Source is fetched with **one** API call for the whole repository — a tarball
download — streamed through gunzip and tar, keeping only the selected paths in
memory. Requesting blobs individually would be an N+1 against an API that
allows 60 anonymous requests an hour, so a few hundred files would exhaust the
quota outright.

Total GitHub cost per analysis is **three calls regardless of repository
size**: metadata, recursive tree, archive.

Authentication flows exactly as in Phase 3 — the credential reaches GitHub and
stops there. **The parser only ever receives source text**; no token, request,
session or user is passed into it.

### Analysis limits

Configurable in `backend/.env` (see `.env.example`). Reaching one produces a
partial analysis flagged `truncated`, never a failure, and the UI says so:

| Variable | Default | Protects |
| --- | --- | --- |
| `DRIFTWATCH_MAX_SOURCE_FILES` | 600 | parsing time, graph size |
| `DRIFTWATCH_MAX_FILE_SIZE_BYTES` | 512 KB | memory |
| `DRIFTWATCH_MAX_TOTAL_SOURCE_BYTES` | 24 MB | memory |
| `DRIFTWATCH_MAX_REPO_SIZE_KB` | 250 MB | download time |

File selection is sorted by path and taken in order, so the same repository
snapshot always yields the same selection.

### API

`POST /api/github/dependencies`

```json
{ "url": "https://github.com/owner/repository" }
```

```json
{
  "success": true,
  "data": {
    "repository": { "owner": "reduxjs", "name": "redux", "defaultBranch": "master" },
    "nodes": [{ "id": "src/App.tsx", "path": "src/App.tsx", "label": "App.tsx", "type": "file" }],
    "edges": [{
      "id": "src/App.tsx->src/components/Header.tsx",
      "source": "src/App.tsx",
      "target": "src/components/Header.tsx",
      "type": "internal"
    }],
    "stats": {
      "filesAnalyzed": 122, "filesSkipped": 0, "filesFailed": 0,
      "dependenciesFound": 340, "internalDependencies": 146,
      "externalImports": 176, "externalPackages": 54,
      "unresolvedImports": 15, "truncated": false
    }
  }
}
```

An edge means **source imports target**. Errors reuse the existing envelope
and status semantics (400 / 401 / 403 / 404 / 429 / 502), and
`POST /api/github/tree` is unchanged.

### Determinism

Node ids are repository paths and edge ids are `source->target`, so both are
stable. Nodes and edges are sorted by id, duplicate edges are collapsed (a
module imported twice yields one edge), and nothing depends on object
insertion order. The same repository snapshot always produces the same graph.

Circular dependencies are valid input: a cycle yields the nodes and both
directed edges. Graph construction is a single pass over parsed files and the
layout is an iterative layering pass, so no cycle can recurse forever.

### The Dependencies view

- **Statistics** — files analyzed, internal dependencies, external packages,
  unresolved imports, and files that failed to parse.
- **Filtering** — free-text path search and a top-level directory selector,
  both clearable. An edge is kept only when both endpoints survive, so the
  graph never shows a dangling edge.
- **Node details** — click a node for its path, dependency and dependent
  counts, and the lists of both.
- **Focus** — reduce the graph to one file and its direct neighbourhood.
- **Size protection** — above `MAX_DEPENDENCY_GRAPH_NODES` (200) the graph is
  *not* drawn. Rather than showing an arbitrary subset, the view explains the
  situation and asks for a filter. The page stays responsive throughout.

### Security

Repository code is untrusted **data**. It is never executed: no `eval`, no
`new Function`, no dynamic import of repository code, no npm install, no build
or shell commands. Tree-sitter only parses text, and archive entries are never
written to disk.

Repository-controlled strings — file paths and names — are rendered as text by
React. `dangerouslySetInnerHTML` is not used for any Phase 4 content. The
Phase 2 escaping and path protections are unchanged.

### Known limitations

- Only `.js`, `.jsx`, `.ts`, `.tsx`. Not `.mjs`, `.cjs`, `.mts`, `.cts`, Vue
  or Svelte single-file components.
- `package.json` `imports`/`exports` maps, webpack and Vite alias config are
  not read; only `tsconfig.json`/`jsconfig.json` paths.
- Import specifiers built at runtime are ignored by design.
- Selection under the file limit is alphabetical, so a partial analysis of a
  large repository covers an alphabetical prefix rather than the "most
  important" files.
- Resolution is case-sensitive, matching the GitHub tree.

## Phase 5 — GitHub Actions CI/CD Visualization

Phase 5 reads a repository's GitHub Actions workflows and draws each one's job
dependency graph, with the selected job's steps alongside.

> **DriftWatch statically analyzes GitHub Actions workflow definitions. It
> never executes workflows, actions, shell commands, or repository code.**

```text
Repository tree                    (Phase 1)
      ↓
.github/workflows/*.yml|*.yaml     discovery only in that directory
      ↓
Workflow source                    one archive download (Phase 4 acquisition)
      ↓
YAML parse                         yaml 1.2, never evaluated
      ↓
Normalized workflow model
      ↓
Mermaid flowchart                  JOB → JOB
      ↓
CI/CD explorer
```

The application now has four views: **File Tree**, **Architecture** (Phase 2,
Mermaid), **Dependencies** (Phase 4, React Flow) and **CI/CD** (Phase 5,
Mermaid). The earlier views are unchanged.

### Supported workflow files

Only `.github/workflows/*.yml` and `*.yaml` are read — nested directories and
the rest of the repository are never scanned for workflow-shaped files. A
repository with no workflows is a valid, complete result, not an error.

### The `on:` trap

Under YAML 1.1 the key `on` is a boolean, so a careless parser turns every
workflow's `on:` block into `true:` and silently loses all triggers.
DriftWatch parses with `yaml` (YAML 1.2), where `on` stays a string key, and a
test asserts this for the scalar, list, map, quoted and `schedule` forms.

### What is extracted

| From | Fields |
| --- | --- |
| Workflow | `name` (or derived from the filename: `ci.yml` → `CI`), triggers, jobs |
| Triggers | event name, plus `branches`, `branches-ignore`, `tags`, `paths`, `types`, `cron` |
| Job | `id`, `name` (or the id), `needs`, `runs-on`, `if`, `environment`, `timeout-minutes`, `continue-on-error`, `uses`, matrix, steps |
| Step | `id`, `name`, `uses`, `run`, `if`, and whether `with`/`env` are present |

`needs` is accepted as both a scalar (`needs: build`) and a list
(`needs: [build, lint]`), deduplicated and sorted. **Only an explicit `needs`
creates an edge** — nothing is inferred from the order jobs appear in.

### Matrix and reusable workflows

A `strategy.matrix` is *described*, never expanded: `node: [18, 20, 22]` with
`os: [ubuntu, windows]` shows as `matrix ×6` on the node and
`node = 18, 20, 22 · os = …` in the details, rather than becoming six jobs.

A job with `uses:` (`./.github/workflows/deploy.yml` or
`org/repo/.github/workflows/deploy.yml@main`) is recorded as a reusable-workflow
job and labelled as such. It is never followed or recursively analyzed.

### Secrets

Secret references are never resolved, and no GitHub API is called to read
secrets. `with:` and `env:` blocks routinely contain
`${{ secrets.API_KEY }}`, so **only their presence is carried** — the values
never enter the DTO at all. A test asserts that secret names from a fixture do
not appear anywhere in the serialized response.

### The job graph

```text
flowchart TD
  job_1["Build<br/>ubuntu-latest<br/>2 steps"]
  job_2["Deploy<br/>ubuntu-latest<br/>1 step"]
  job_1 --> job_2
```

The primary graph is **job → job** only. Steps never become graph nodes, so a
workflow with hundreds of steps still produces a small diagram; the steps live
in the details panel. Node ids are sequential (`job_1`, `job_2`, …) assigned in
the jobs' sorted order, so they are deterministic and cannot collide however
exotic a job id is. A `needs` naming a job that is not in the workflow is
skipped rather than turned into an invented node.

### Security

Workflow files are untrusted data. Every label goes through the same
`escapeLabel` used by Phase 2, and Mermaid runs with `securityLevel: "strict"`
and `htmlLabels: false`. A job named `<script>alert(1)</script>` renders as
that literal text in both the diagram and the UI.

Tested against hostile values including `<script>`, `<img onerror>`, `<svg>`,
`"] --> evil["`, backticks, pipes, braces, `-->`, `flowchart TD` and embedded
newlines: none can inject a node, an edge, a directive or HTML. No `eval`,
`new Function`, `child_process`, `exec` or `spawn` is used anywhere in workflow
processing.

### Limits

| Variable | Default | Protects |
| --- | --- | --- |
| `DRIFTWATCH_MAX_WORKFLOWS` | 50 | parse time, response size |
| `DRIFTWATCH_MAX_JOBS_PER_WORKFLOW` | 100 | diagram size |
| `DRIFTWATCH_MAX_STEPS_PER_JOB` | 100 | response size |

Reaching a limit produces a partial result flagged `truncated`, and the UI says
so. A single unreadable workflow is reported with a `parseError` and does not
stop the others from being analyzed.

### API

`POST /api/github/workflows`

```json
{ "url": "https://github.com/owner/repository" }
```

```json
{
  "success": true,
  "data": {
    "repository": { "owner": "…", "name": "…", "defaultBranch": "…" },
    "workflows": [
      {
        "path": ".github/workflows/ci.yml",
        "name": "CI",
        "triggers": [{ "event": "push", "branches": ["main"] }],
        "jobs": [
          {
            "id": "build", "name": "Build", "needs": [],
            "runsOn": "ubuntu-latest",
            "steps": [{ "uses": "actions/checkout@v4", "hasWith": false, "hasEnv": false }],
            "stepCount": 1, "stepsTruncated": false
          }
        ],
        "jobCount": 1, "jobsTruncated": false
      }
    ],
    "stats": {
      "workflowsFound": 1, "workflowsAnalyzed": 1,
      "workflowsFailed": 0, "truncated": false
    }
  }
}
```

URL validation, authentication and error semantics (400/401/403/404/429/502)
are the existing shared ones — nothing is duplicated. `POST /api/github/tree`
and `POST /api/github/dependencies` are unchanged.

### GitHub request cost

Three API calls per analysis regardless of how many workflows, jobs or steps a
repository has: repository metadata, the recursive tree, and one archive
download — the same acquisition Phase 4 uses. There is no per-workflow,
per-job or per-step request.

### Caching

Workflow analysis is lazy (nothing is requested until the CI/CD tab is first
opened) and cached per analysis. Moving between Architecture, Dependencies and
CI/CD issues **no** further requests, while re-analyzing the same repository
invalidates the cache — the key is the analysis identity, not the URL alone.

### Known limitations

- Reusable workflows are recorded but not recursively analyzed.
- Composite action internals are not read; `uses:` is shown as written.
- Expressions (`${{ … }}`) are displayed verbatim, never evaluated, so a job
  name built from an expression shows the expression.
- `include`/`exclude` matrix entries are noted as present but not itemized.
- Workflow-level `env`, `defaults`, `concurrency` and `permissions` are not
  modelled.

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
(including ID collisions, escaping, the max-node guard and determinism),
architecture-view navigation, and the dependency graph model (layout,
filtering, focus). The backend has its own suite for URL parsing, GitHub error
mapping, credential isolation, the auth flow, Tree-sitter extraction,
dependency resolution and graph construction:

```bash
npm test --workspace=backend
```
