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

**Phase 6** adds Call Flow: pick an entry-point function in a JavaScript or
TypeScript repository and see the statically inferred calls reachable from
it, as a Mermaid sequence diagram. Call Flow is statically inferred from
source code and is not runtime tracing.

**Phase 7** adds History: commit history, commit detail, comparing two
commits, change hotspots, contributor activity, and dependency-aware impact
analysis — which files are statically reachable from a change, reusing Phase
4's dependency graph and, optionally, Phase 6's call graph. Impact analysis is
statically inferred from repository history and dependency relationships; it
is not runtime failure prediction.

**Phase 8** adds Schema: database schemas statically discovered from Prisma,
SQL and Mongoose source files, normalized into one provider-independent model
and drawn as an ER-style React Flow graph. Schema analysis is statically
inferred from repository source files; DriftWatch does not connect to or
execute against a live database.

Persistence does not exist yet — that belongs to a later phase.

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

### GitHub Authentication — Local Development

Public repositories work with no setup at all. **Sign-in is only needed to
analyze private repositories.** Until it is configured, "Connect GitHub"
reports that sign-in is unavailable and everything else keeps working.

#### 1. Register a GitHub App

DriftWatch uses a **GitHub App** with the user authorization (user-to-server)
flow — not an OAuth App, and not installation tokens. Create one at
<https://github.com/settings/apps/new>:

| Setting | Value |
| --- | --- |
| GitHub App name | anything, e.g. `DriftWatch (local)` |
| Homepage URL | `http://localhost:5173` |
| **Callback URL** | `http://localhost:5000/api/auth/github/callback` |
| Request user authorization (OAuth) during installation | **enabled** |
| Webhook → Active | **disabled** |
| Repository permissions → Contents | Read-only |
| Repository permissions → Metadata | Read-only (mandatory) |

The callback URL must match the backend exactly: that is the route the backend
serves, and GitHub rejects any mismatched `redirect_uri`.

Afterwards, **Install** the app on the account or organization whose private
repositories you want to analyze.

#### 2. Copy the credentials into `backend/.env`

On the app's settings page, note the **Client ID** and use *Generate a new
client secret*. Then in `backend/.env`:

```bash
PORT=5000
FRONTEND_URL=http://localhost:5173

GITHUB_APP_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
GITHUB_APP_CLIENT_SECRET=your-client-secret
```

Only those two are required. `GITHUB_APP_CALLBACK_URL` is optional and
defaults to `http://localhost:<PORT>/api/auth/github/callback`; set it
explicitly for any non-local deployment.

The app's **private key and App ID are not needed** — DriftWatch never mints
installation tokens, so the private key never has to exist on this machine.

> `backend/.env` is git-ignored and must never be committed. `.env.example`
> holds placeholder names only. The client secret stays on the server: it is
> never sent to the browser, never written to a response, and never logged.

#### 3. Sign in

```bash
npm run dev
```

Open <http://localhost:5173>, click **Connect GitHub**, authorize the app, and
GitHub returns you to DriftWatch signed in. Private repositories you have
access to can then be analyzed like any other.

#### If it does not work

The sign-in route distinguishes three states, so the message tells you where
you are:

| Response from `GET /api/auth/github` | Meaning |
| --- | --- |
| Redirect to `github.com/login/oauth/authorize` | Configured correctly |
| `GitHub sign-in is not configured on this server.` | Neither credential is set |
| `GitHub sign-in is misconfigured on this server.` | One of the two is missing — **the server log names which** |

Variable names appear only in the server log, never in the HTTP response, and
credential values appear in neither.

Other things worth checking:

- The GitHub App's Callback URL matches `http://localhost:5000/api/auth/github/callback` character for character.
- "Request user authorization (OAuth) during installation" is enabled.
- The app is **installed** on the account owning the repository — a private
  repository the app cannot see returns `GitHub repository not found`, because
  GitHub deliberately hides its existence.
- The backend was restarted after editing `.env`.

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

## Phase 6 — Function Call Graph

Call Flow lets you pick an entry-point function in a JavaScript or TypeScript
repository and see the calls statically reachable from it, drawn as a Mermaid
sequence diagram.

> **Call Flow is statically inferred from source code and is not runtime
> tracing.** No repository code is ever executed to produce it — not with
> `eval`, `new Function`, `child_process`, or any other means. Everything
> shown is inferred by reading the AST.

### Static function analysis

Reuses Phase 4's Tree-sitter setup, source acquisition and import resolver
verbatim — there is no second GitHub downloader, parser, or resolution
system. One additional pass over the same parsed files extracts:

- **Functions**: declarations, expressions, arrow functions, class methods
  and constructors, object-literal methods, class-property arrow functions,
  and exported/default-exported functions — in `.js`, `.jsx`, `.ts` and
  `.tsx`, including inside JSX.
- **Calls**: direct (`foo()`), member (`obj.foo()`), `await`, `new`, and a
  callback heuristic — a bare function reference passed as an argument
  (`items.map(transform)`, `Promise.resolve().then(handle)`) is treated as a
  probable call, but only when it resolves to a real function; an
  unresolved reference is silently dropped rather than counted as a finding.

### Function identities

Ids are deterministic: `<path>::<name>` for a named function
(`src/services/orderService.ts::createOrder`), `<path>::<ClassName>.<method>`
for a class member, and `<path>::<context>@<line>` for anything with no
stable name (an anonymous callback). A same-file naming collision is broken
by appending the line number, then a counter — always deterministically, from
the file's own content.

### Static call resolution

In priority order: a same-file function, a same-file `const x = () => {}`
binding, a named/aliased/default/namespace import, one hop of `export …
from`, a class method via `this.method()`, and an object-literal method via
`obj.method()`. Nothing is ever guessed: a dynamic call
(`obj[name]()`, `const fn = getHandler(); fn();`) is reported as unresolved,
and a call resolved to something outside the repository (`axios.get()`) is
reported as external — neither ever becomes a fabricated internal edge.

### Entry-point selection

The **Entry File** and **Entry Function** selectors list every extracted
function, grouped by file. If no entry point is chosen, the backend picks one
deterministically: an exported `main`, then any `main`, then a default
export, then the first function by sorted id — never inventing one when a
repository has no statically extractable functions.

### Recursion and cycles

Traversal is breadth-first with a visited set, so `a -> b -> a` and direct
self-recursion (`factorial -> factorial`) both terminate — a cycle
contributes at most one node and, for each direction actually called, one
edge, never an infinite one.

### Graph limits

| Limit | Value | Protects |
| --- | --- | --- |
| `MAX_CALL_GRAPH_NODES` | 100 | diagram size, traversal time |
| `MAX_CALL_GRAPH_DEPTH` | 10 | diagram size, traversal time |

Reaching either produces a `truncated: true` result with a `truncationReason`
of `max_nodes` or `max_depth` — never silently. A defensive whole-repository
ceiling (4,000 functions, 20,000 edges) also exists purely to bound memory
against a pathological file; realistic repositories, already bounded by Phase
4's file-count and file-size limits, never approach it.

### Mermaid sequence diagram

Participant ids are always sequential (`function_1`, `function_2`, …), never
derived from source text, and every label passes through the same
entity-code escaping the architecture and CI/CD diagrams use
(`escapeLabel`), so a malicious function name cannot inject a new Mermaid
directive or markup — `mermaid.render()` also runs with `securityLevel:
"strict"`, sanitising the output regardless.

### Caching

The backend keeps a short-lived (5-minute), size-bounded (20-entry) in-memory
cache of the parsed function/call index, keyed by repository **and** by the
caller's identity (a hash of their credential, or an anonymous marker) — so
switching the selected entry point re-runs only the traversal, with no new
GitHub calls and no re-parsing, while a different user's private-repository
analysis can never be served from another user's cache entry. Moving between
tabs issues no further requests, and a fresh **Analyze Repository** always
starts a new analysis.

### API

`POST /api/github/call-graph`

```json
{ "url": "https://github.com/owner/repository", "entryPoint": "src/server.ts::startServer" }
```

`entryPoint` is optional; omit it for the backend's own default.

```json
{
  "success": true,
  "data": {
    "repository": { "owner": "…", "name": "…", "defaultBranch": "…" },
    "entryPoint": { "functionId": "src/server.ts::startServer", "file": "src/server.ts", "name": "startServer" },
    "nodes": [
      { "id": "src/server.ts::startServer", "file": "src/server.ts", "name": "startServer",
        "displayName": "startServer", "startLine": 10, "endLine": 15,
        "kind": "function-declaration", "exported": true }
    ],
    "edges": [
      { "source": "src/server.ts::startServer", "target": "src/auth/login.ts::authenticate",
        "callExpression": "authenticate()", "line": 12, "callCount": 1 }
    ],
    "availableEntryPoints": [
      { "id": "src/server.ts::startServer", "file": "src/server.ts", "name": "startServer", "startLine": 10, "endLine": 15 }
    ],
    "stats": {
      "functionsDiscovered": 18, "functionsReachable": 7, "edges": 9,
      "unresolvedCalls": 2, "externalCalls": 1, "maxDepth": 4
    },
    "truncated": false
  }
}
```

URL validation, authentication and error semantics (400/401/403/404/429/502)
are the existing shared ones — nothing is duplicated.

### Known limitations

- A member chain deeper than one hop (`obj.foo.bar()`) is recorded as a call
  site but not resolved.
- An object literal's method table only covers `const obj = { m() {} }` at
  the point it is declared, not properties added elsewhere.
- `new Foo()` resolves to `Foo`'s constructor only when `Foo` is statically
  visible (a same-file class, or one reached through import resolution).
- Reusable-workflow-style indirection (dependency injection, dynamic
  dispatch tables, higher-order factories that return functions) is not
  modelled — this is source-level static analysis, not type inference or
  data-flow analysis, and dynamic calls it cannot prove are reported as
  unresolved rather than guessed.

## Phase 7 — Git History, Evolution & Impact Analysis

Phase 7 lets you inspect how a repository has evolved and understand the
likely reach of a change — all read through the GitHub REST API. No
repository is ever cloned, and no `git` command is ever run.

### Commit history and the Evolution Timeline

The **History** tab's Evolution Timeline shows the repository's commits
newest-first, 30 at a time by default: short SHA, message, author and date.
Selecting a commit opens **Commit Details** — full SHA, author, date, and
every changed file with its status (added / modified / removed / renamed /
copied) and additions/deletions. Clicking a file opens its own **file
history**: every commit that touched it, plus evolution stats —
`totalCommits`, `activeAuthors`, a `recentChangeRate` (the fraction of those
commits from the last 90 days), and `averageChangesPerCommit`. That last
field is explicitly `null`, never a fabricated number, when per-commit size
data was not fetched — see Known limitations below.

### Change hotspots and contributor activity

**Change Hotspots** aggregates, over the commits currently loaded, which
paths changed most often and by how much. **Change hotspots represent
observed historical change frequency and should not be interpreted as a
measure of code quality or bug-proneness** — the UI says so directly, not
only this document. **Contributors** is a plain, descriptive table — commits,
files changed, additions, deletions per author — deliberately with no
ranking or "best contributor" score.

Both are more expensive than the plain commit list (GitHub's commit-list API
carries no file or size information, so each commit on the page is inspected
individually), so neither loads until you open that section.

### Compare Commits

Enter a base and a head commit/ref and compare them directly: files changed,
total additions/deletions, and the same changed-file list as Commit Details.
Uses GitHub's own compare endpoint — the repository's contents are never
downloaded just to diff two commits.

### Impact analysis

This is Phase 7's core feature: given a comparison, which other files are
**statically reachable** from what changed.

```
compare commits → changed files → Phase 4's dependency graph (as of `head`)
  → reverse-dependency traversal → directly/transitively affected files
  → optional Phase 6 function-level relationships → the impact graph
```

The dependency graph is Phase 4's own `buildDependencyGraph`, unmodified —
Phase 7 does not implement a second import resolver. Its edges (`A` imports
`B`) are read in reverse: if `B` changes, everything that imports `B` is
*directly affected*, and everything that imports **those** files is
*transitively affected*, out to the configured depth. A changed file with no
node in the dependency graph at all (not a supported source file, or deleted)
is reported as **unresolved**, not silently treated as having no impact.

> **Impact analysis is statically inferred from repository history and
> dependency relationships. It is not runtime failure prediction.** This
> disclaimer is always shown in the Impact Analysis section, and is included
> in the API response's `warnings` whenever the graph was truncated or any
> changed file could not be statically resolved.

**Function-level impact** (optional, spec section 14): when the changed files
contain JavaScript/TypeScript functions, Phase 6's call-graph extraction runs
on the exact same source already downloaded for the dependency graph — no
extra GitHub calls. It reports which functions in the changed files have
statically known callers elsewhere, labelled as **"Function-level analysis
available"** rather than claiming line-level precision: GitHub's diff data
does not reliably map to which function a line falls inside, so Phase 7 does
not attempt that.

The **Impact** view renders the graph with React Flow — the same library
Phase 4's Dependencies view already uses, laid out with Phase 4's own layered
layout algorithm — with a path search box, a display-only depth filter, and a
node-details panel (relationship, depth, change status, dependencies/
dependents). Nodes are colour-coded: changed (red), directly affected (blue),
transitively affected (amber), unresolved (dashed).

### Limits

| Limit | Default | Protects |
| --- | --- | --- |
| `DRIFTWATCH_MAX_HISTORY_COMMITS` | 100 | the hard ceiling on `perPage` for any history request |
| `DRIFTWATCH_MAX_COMMIT_FILES` | 300 | files kept in one commit's or comparison's file list |
| `DRIFTWATCH_MAX_IMPACT_FILES` | 200 | files (changed + affected) kept in one impact graph |
| `DRIFTWATCH_MAX_IMPACT_DEPTH` | 5 | reverse-dependency hops traversed from a changed file |

Reaching a limit always produces `truncated: true` with a `truncationReason`
(`max_files` or `max_depth`) — never silent — and the UI shows a warning.

### API

| Endpoint | Purpose | GitHub calls |
| --- | --- | --- |
| `POST /api/github/history` | paginated commit list | 2 (repo info + `listCommits`) |
| `POST /api/github/commit` | one commit's full detail | 2 (repo info + `getCommit`) |
| `POST /api/github/compare` | diff between two refs | 2 (repo info + `compareCommitsWithBasehead`) |
| `POST /api/github/file-history` | commits touching one path | 2 (repo info + `listCommits` with `path`) |
| `POST /api/github/history-stats` | hotspots + contributors | 2 + one `getCommit` per commit on the page (bounded by `perPage`, ≤ 100) |
| `POST /api/github/impact` | dependency-aware impact graph | 1 compare + 1 tree-at-ref + 1 archive download (reuses Phase 4's acquisition) |

```json
// POST /api/github/impact
{ "url": "https://github.com/owner/repository", "base": "<sha>", "head": "<sha>", "maxDepth": 3 }
```

```json
{
  "success": true,
  "data": {
    "repository": { "owner": "…", "name": "…", "defaultBranch": "…" },
    "comparison": { "base": "…", "head": "…" },
    "changedFiles": ["src/auth/service.ts"],
    "affectedFiles": ["src/api/routes.ts", "src/controllers/user.ts"],
    "nodes": [
      { "id": "src/auth/service.ts", "path": "src/auth/service.ts", "relationship": "changed", "depth": 0, "changeStatus": "modified" },
      { "id": "src/api/routes.ts", "path": "src/api/routes.ts", "relationship": "direct", "depth": 1 }
    ],
    "edges": [{ "source": "src/api/routes.ts", "target": "src/auth/service.ts" }],
    "stats": { "changedFiles": 1, "affectedFiles": 1, "maxDepth": 1 },
    "functionImpact": { "available": true, "changedFunctions": [], "affectedFunctions": [] },
    "warnings": [],
    "truncated": false
  }
}
```

URL validation, authentication and the shared error envelope are unchanged
and reused as-is. A 404/422 from `getCommit` or `compareCommitsWithBasehead`
is reported as "Commit not found" / "One or both commit references could not
be found or compared" rather than the generic "GitHub repository not found"
Phase 1's mapper uses for `repos.get` — a small, additive refinement layered
on top of the shared error mapper, not a change to it.

### Caching

Every endpoint keeps a short-lived (5-minute), size-bounded, in-memory cache
on the backend, keyed by the repository **and** by the caller's identity (a
hash of their credential, or a fixed anonymous marker) — the same pattern
Phase 6 introduced for the call graph, now shared via `scopedCache.ts` across
history, commit, compare, file-history, history-stats and impact. A
credential is never part of a cache key in its raw form, and one user's
cached result can never be served to another.

The frontend layers its own cache on top: the Evolution Timeline loads
automatically per `(repository, page, filters)` exactly like Dependencies/
CI/CD/Call Flow, while Commit Details, Compare, Hotspots/Contributors, File
History and Impact Analysis are all on-demand — they fetch only when the
user selects a commit, clicks Compare, opens a section, or clicks Analyze
Impact, and each keeps its own small per-session cache keyed by sha / path /
`base...head`, so switching back to an already-viewed commit is instant and
makes no request. Switching tabs away from History and back makes none
either.

### Security

Commit messages, author names, branch names and file paths are
repository-controlled strings. They are rendered as plain React text
everywhere and are never executed, never passed to a shell, and never used
to resolve a filesystem path. A base/head ref is validated against a strict
character set and rejects anything containing `..` before it ever reaches
GitHub's compare endpoint, both because a real ref never contains `...` (the
compare endpoint's own separator) and to keep the constructed `base...head`
string unambiguous. The impact graph uses React Flow, not Mermaid, so no new
Mermaid-injection surface exists in Phase 7; everywhere Phase 2/5/6's
`escapeLabel` utility would apply, it is reused, not reimplemented. All
lookup tables keyed by repository-controlled strings (paths, author
identities) use `Map`, which is immune to prototype pollution the way a
plain object literal is not.

### Known limitations

- `FileHistoryEntry.additions`/`.deletions` are omitted (not fabricated as
  zero) because `GET .../commits?path=...` — the one call this endpoint
  makes — carries no per-commit size data; getting it would cost one
  additional GitHub request per commit. `averageChangesPerCommit` is `null`
  for the same reason. Hotspots and Contributors do fetch real size data,
  because the user explicitly opts into that cost by opening those sections.
- Impact analysis inherits Phase 4's import resolution exactly as-is, by
  design (`do not create a second import resolver`). In particular, explicit
  `.js`-extension imports in a TypeScript ESM/NodeNext-style codebase
  (`import { x } from "./utils.js"` where the source file is `utils.ts`) are
  not resolved to their `.ts` file by Phase 4's resolver, so such a
  repository's impact graph will under-report affected files. This is a
  pre-existing Phase 4 characteristic, observed directly while validating
  Phase 7 against a real repository using that import style.
- A renamed file is tracked as "changed" at its new path; dependents are
  discovered only via the dependency graph at `head`, not retroactively via
  the file's previous path.
- Function-level impact reports direct callers only, one hop, never a
  multi-level call-graph traversal — intentionally shallow, matching the
  spec's "Function-level analysis available" rather than exact-impact framing.
- GitHub's own undocumented internal truncation of very large diffs (rather
  than DriftWatch's own `maxCommitFiles` cap) cannot be detected separately
  from an ordinary, complete, small file list.

## Phase 8 — Database Schema Visualizer

Schema statically discovers database schemas from repository source — Prisma,
SQL and Mongoose — and draws them as an interactive, ER-style React Flow
graph: one box per model/table, with its fields, keys and relationships.

> **Schema analysis is statically inferred from repository source files.
> DriftWatch does not connect to or execute against a live database.** No
> `.prisma` file is ever handed to the Prisma CLI, no SQL statement is ever
> executed, and no `mongoose.connect()` call is ever made — every fact here
> comes from reading text and, for Mongoose, the same Tree-sitter AST Phase 4
> already builds.

### Supported providers

| Provider | Detected by | Parsed with |
| --- | --- | --- |
| **Prisma** | any `*.prisma` file (`schema.prisma`, `prisma/schema.prisma`, nested files) | a hand-written parser over Prisma's own small DSL — there is no Prisma grammar already a dependency here, and the Prisma CLI is never invoked |
| **SQL** | any `.sql` file | a hand-written parser over `CREATE TABLE` — a practical subset of common DDL, not a full dialect parser for any one database |
| **Mongoose** | a JS/JSX/TS/TSX file, but *only* when it contains a recognisable `new Schema(...)`/`model(...)` pair — never every JS/TS file in the repository | Phase 4's own Tree-sitter infrastructure (`parseSource`/`detectLanguage`), the same one Phase 4/6 already use |

A repository can contain more than one provider at once (e.g. a Prisma schema
alongside hand-written migration SQL); each model keeps its own `sourceType`
and `sourcePath`, and the three are never silently merged just because two
models happen to share a name — see **Multiple providers** below.

### Unified schema model

Every provider normalizes into the same shape: a `SchemaModel` (name,
provider, source path, `SchemaField[]`, `SchemaIndex[]`) and a
`SchemaRelationship` (source/target model, cardinality, explicit
`sourceField`/`targetField`, an optional relation name, and `inferred`). The
frontend knows only this unified shape — never a Prisma AST node, a SQL
parse-tree fragment, or a Tree-sitter node.

### Prisma parsing

Comments (`//`, `/* */`) are stripped first, respecting quoted strings (a
`@default("https://example.com")` keeps its `//`), and a multi-line
`@relation(\n  fields: [...],\n  references: [...]\n)` is joined before
field-by-field parsing. Extracted per field: scalar type, `[]`/`?` markers,
`@id`, `@unique`, `@default(...)`, and `@relation(...)` (fields, references,
name); extracted per model: `@@id`, `@@unique`, `@@index`. A model this parser
cannot make sense of is skipped with a warning — the rest of the file is
still used.

### SQL parsing

Covers `CREATE TABLE` only: inline and table-level `PRIMARY KEY`, `UNIQUE`,
`NOT NULL`, `DEFAULT`, inline `REFERENCES`, table-level `FOREIGN KEY ...
REFERENCES`, `CONSTRAINT`-named variants, and `KEY`/`INDEX`. Quoted
identifiers (`"name"`, `` `name` ``, `[name]`) are unquoted; `--` and `/* */`
comments are stripped the same way Prisma's are, respecting single-quoted
string literals. A table this parser cannot make sense of is skipped with a
warning.

### Mongoose parsing

Recognises `new Schema({...})` / `new mongoose.Schema({...})` (bare or
namespaced, via `require` or a destructured import) paired with
`model("Name", schemaRef)` / `mongoose.model("Name", schemaRef)`, including an
inline schema passed directly as the second argument. Field shapes handled:
a bare scalar (`name: String`), a `Types.ObjectId`-style member chain,
detailed options (`{ type, required, unique, default, ref, enum }`), arrays
of any of those (`[String]`, `[{ type: ObjectId, ref: "Post" }]`), and nested
subdocuments (an object with no `type` key), which are flattened into
dotted field names (`profile.bio`) rather than modelled as a separate model.
A dynamic expression as a field's type (a function call, a variable that
is not itself resolvable) is left alone, never guessed at.

### Relationship detection

In priority order (spec section 12): explicit relationship metadata (Prisma's
`@relation`, Mongoose's `ref:`) before an explicit foreign key/reference (SQL's
`REFERENCES`) before a deterministic ORM relation (Prisma's implicit
many-to-many) before safe structural inference. A name-based resemblance
alone (`userId` looking like it means `User`) is never treated as explicit,
and a relationship is never invented when the syntax is ambiguous — see
**Explicit vs. inferred** below.

### Explicit vs. inferred, and cardinality

Every relationship carries `inferred: false` when the source syntax
explicitly declares it (Prisma's `@relation`, SQL's `REFERENCES`, Mongoose's
`ref:`) — this repository's parsers never currently produce `inferred: true`,
since every shape they recognise is already explicit; a future, looser
heuristic (e.g. purely name-based) would be the first to set it. Cardinality
follows the same no-guessing rule: a Prisma scalar FK field (with
`@relation(fields:…, references:…)`) is `1:N`, or `1:1` when that field is
also unique/the primary key; a SQL `REFERENCES` is `1:N`; a Mongoose singular
`ref:` is `1:N`; a Mongoose **array** of refs is `unknown` unless this
parser can find nothing that makes it unambiguous — never guessed at as N:M
or N:1. An implicit Prisma many-to-many (two plain array fields pointing at
each other, no scalar FK on either side) is `N:M`.

### React Flow / layout

Each model/table is one React Flow node — a plain-HTML/CSS field table
(header: name + provider; one row per field with its type and PK/UQ flags),
not Mermaid — laid out with Phase 4's own layered layout algorithm
(`layoutGraph`, adapted to the schema shape rather than duplicated). The same
library Phase 4's Dependencies view and Phase 7's Impact view already use;
no second graph library is introduced. Clicking a node opens a details panel:
provider, source path, every field with its type/flags, indexes, and this
model's relationships, each labelled direct/reverse and explicit/inferred.

### Search and filters

Search matches a model's own name or any `Model.field` pair — searching
"user" finds both the `User` model and an unrelated model's `Post.userId`
field, per spec section 19's own example. Provider and relationship-
cardinality filters, and a show/hide-fields toggle, are all applied
client-side over the already-fetched analysis. None of search, the filters,
or selecting a node ever issues another GitHub request.

### Limits

| Limit | Default | Protects |
| --- | --- | --- |
| `MAX_SCHEMA_MODELS` | 200 | total models/tables kept in one analysis |
| `MAX_SCHEMA_FIELDS_PER_MODEL` | 100 | fields kept per model |
| `MAX_SCHEMA_EDGES` | 400 | relationships kept in one graph |

Reaching a limit always produces `truncated: true` with a `truncationReason`
(`max_models`, `max_fields` or `max_edges`) and a visible warning — never
silent. Truncation that originates upstream of these caps (GitHub's own tree
truncation, or the shared `maxSourceFiles` limit leaving some candidate
schema files unselected) is reported too, with its own explanation, rather
than left as an unexplained `truncated: true`.

### API

`POST /api/github/schema`

```json
{ "url": "https://github.com/owner/repository" }
```

A repository with no detected schema is **not** an error:

```json
{
  "success": true,
  "data": {
    "repository": { "owner": "…", "name": "…", "defaultBranch": "…" },
    "providers": [],
    "schemas": [],
    "relationships": [],
    "nodes": [],
    "edges": [],
    "stats": { "models": 0, "fields": 0, "relationships": 0, "primaryKeys": 0, "foreignKeys": 0, "indexes": 0, "byProvider": {} },
    "warnings": ["No supported database schema definitions were detected."],
    "truncated": false
  }
}
```

URL validation, authentication and the shared error envelope are unchanged
and reused as-is.

### GitHub request cost

Exactly the three calls Phase 4 already uses for a fresh analysis —
repository metadata, the recursive tree, one archive download — regardless of
how many schema files, models or fields a repository has. No schema file is
ever fetched individually; candidate Prisma/SQL/Mongoose paths are collected
from the already-fetched tree and their content comes from that same one
archive.

### Caching

The backend keeps a short-lived (5-minute), size-bounded, in-memory cache
keyed by the repository **and** by the caller's identity (a hash of their
credential, or a fixed anonymous marker) — the same `scopedCache.ts` Phase 6
introduced and Phase 7 already shares. Switching between `All` and a specific
provider, changing the relationship filter, typing in search, toggling field
visibility, or selecting a node never triggers a request; switching tabs away
from Schema and back does not either; a fresh **Analyze Repository** always
starts a new analysis.

### Security

Model, field, table and index names are repository-controlled strings. They
are rendered as plain React text everywhere and are never executed — not as
SQL, not as JavaScript, not against a shell. React Flow node and edge ids are
always the parser's own deterministic, internally-generated ids
(`prisma:<path>:<name>`-style), never a raw repository-controlled string
used directly as a DOM/graph id. The ER graph uses React Flow, not Mermaid,
so no Mermaid-injection surface exists in Phase 8. Every lookup table keyed
by a repository-controlled string (model names, field names) uses `Map`,
which is immune to prototype pollution the way a plain object literal is
not.

### Known limitations

- Only `CREATE TABLE` is parsed; `ALTER TABLE`, views, and dialect-specific
  extensions (e.g. Postgres-only syntax) are not modelled.
- Prisma/SQL relationships resolve against every file of the *same* provider
  across the whole repository (so a schema split across several `.prisma`
  files works), but Mongoose relationships resolve by name against whatever
  Mongoose models were found anywhere in the repository — a `ref:` to a model
  name that genuinely does not exist anywhere is dropped, with a warning,
  rather than guessed at.
- A dynamically generated schema (fields built from a loop, a spread of an
  external object, a schema factory function) is not modelled — only
  deterministic, literal AST/text structures are read.
- Multiple schema sources in one repository may represent different versions
  or snapshots of the same data model (e.g. a legacy SQL migration alongside
  a newer Prisma schema); DriftWatch does not attempt to reconcile them, by
  design — see **Multiple providers**.
- Relationships marked `inferred: false` reflect what the source code
  statically and deterministically declares, not runtime database metadata;
  they should not be interpreted as confirmed, currently-enforced
  constraints on a live database.

### Multiple providers

A repository may contain a Prisma schema, SQL migrations and Mongoose models
at once. Models are never merged across providers merely because their
names match — `sourceType` and `sourcePath` are always preserved, and a
relationship is only ever resolved against models of its *own* provider (see
**Security** and **Known limitations**). `providers` in the response lists
every provider actually detected.

## Frontend

The home page provides a repository URL field and an **Analyze Repository**
button. It shows a loading state while fetching, reports errors inline, and on
success displays the repository name, default branch, and file and directory
counts, followed by the File Tree, Architecture, Dependencies, CI/CD, Call
Flow, History and Schema views described above.


## Testing

Frontend unit tests are plain TypeScript with no test-framework dependency:

```bash
npm test --workspace=frontend
```

This covers the tree builder and its size metadata, the Mermaid generators for
the architecture, CI/CD and Call Flow diagrams (including ID collisions,
escaping, the max-node guard and determinism), architecture-view navigation,
the dependency graph model (layout, filtering, focus), the History view's
formatting helpers and its impact-graph layout adapter, the Schema view's
search/filter helpers and its own layout adapter, and response-contract
validation for every endpoint including Phase 7's and Phase 8's. The backend
has its own suite for URL parsing, GitHub error mapping, credential
isolation, the auth flow, Tree-sitter function/call extraction, cross-file
call resolution, call graph traversal, workflow and dependency parsing, the
shared scoped cache, git history mapping/validation, impact-graph traversal,
and the Prisma/SQL/Mongoose schema parsers and graph merging:

```bash
npm test --workspace=backend
```
