import { env } from "../config/env.js";
import { normalizeRepositoryPath } from "../parser/dependencyResolver.js";
import { classifySchemaSource } from "../schema/schemaDetector.js";
import { buildSchemaGraph } from "../schema/schemaGraph.js";
import { looksLikeMongooseSource, parseMongooseFile } from "../schema/mongoose/mongooseParser.js";
import { parsePrismaSchema } from "../schema/prisma/prismaParser.js";
import { parseSqlSchema } from "../schema/sql/sqlParser.js";
import type { ParsedSchemaFile } from "../schema/schemaTypes.js";
import type { SchemaAnalysis } from "../types/schema.js";
import type { GithubCredential } from "../types/github.js";
import { AppError } from "../utils/appError.js";
import { fetchRepositorySnapshot } from "./githubService.js";
import { callerIdentity, createScopedCache } from "./scopedCache.js";
import { fetchRepositorySources, selectSourceFiles } from "./sourceService.js";

/**
 * Phase 8 pipeline: acquire source exactly as Phase 4 does, detect which
 * files are schema sources, run each provider's parser, and merge the
 * results into one unified graph (`buildSchemaGraph`).
 *
 * GitHub cost is the same three calls Phase 4 already uses — metadata,
 * recursive tree, one archive download — regardless of how many schema
 * files or models a repository has; no file is ever fetched individually.
 */

const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;
const schemaCache = createScopedCache<SchemaAnalysis>(SCHEMA_CACHE_TTL_MS, 50);

function emptyAnalysis(repository: SchemaAnalysis["repository"]): SchemaAnalysis {
  const graph = buildSchemaGraph({ prisma: [], sql: [], mongoose: [] });
  return {
    repository,
    providers: graph.providers,
    schemas: graph.schemas,
    relationships: graph.relationships,
    nodes: graph.nodes,
    edges: graph.edges,
    stats: graph.stats,
    warnings: graph.warnings,
    truncated: graph.truncated,
  };
}

export async function analyzeSchema(
  owner: string,
  repo: string,
  credential?: GithubCredential
): Promise<SchemaAnalysis> {
  const key = `${callerIdentity(credential)}::${owner}/${repo}`;
  const cached = schemaCache.get(key);
  if (cached !== null) return cached;

  const snapshot = await fetchRepositorySnapshot(owner, repo, credential);

  if (snapshot.sizeKb > env.analysis.maxRepositorySizeKb) {
    throw new AppError(413, "This repository is too large for schema analysis.");
  }

  const prismaPaths: string[] = [];
  const sqlPaths: string[] = [];
  const mongooseCandidatePaths: string[] = [];

  for (const node of snapshot.tree) {
    if (node.type !== "file") continue;
    const path = normalizeRepositoryPath(node.path);
    if (path === null) continue;

    const candidate = classifySchemaSource(path);
    if (candidate === "prisma") prismaPaths.push(path);
    else if (candidate === "sql") sqlPaths.push(path);
    else if (candidate === "mongoose-candidate") mongooseCandidatePaths.push(path);
  }

  const allCandidates = [...prismaPaths, ...sqlPaths, ...mongooseCandidatePaths].sort();
  const { selected, skipped } = selectSourceFiles(allCandidates, env.analysis.maxSourceFiles);

  if (selected.length === 0) {
    const result = emptyAnalysis(snapshot.repository);
    schemaCache.set(key, result);
    return result;
  }

  const acquisition = await fetchRepositorySources(
    snapshot.repository.owner,
    snapshot.repository.name,
    snapshot.repository.defaultBranch,
    selected,
    credential
  );

  const selectedSet = new Set(selected);
  const prisma: ParsedSchemaFile[] = [];
  const sql: ParsedSchemaFile[] = [];
  const mongoose: ParsedSchemaFile[] = [];

  for (const [path, content] of acquisition.sources) {
    if (!selectedSet.has(path)) continue;

    if (prismaPaths.includes(path)) {
      prisma.push(parsePrismaSchema(path, content));
    } else if (sqlPaths.includes(path)) {
      sql.push(parseSqlSchema(path, content));
    } else if (mongooseCandidatePaths.includes(path)) {
      // The cheap text pre-check avoids running Tree-sitter over every
      // ordinary JS/TS file in the repository — only files that look like
      // they declare a Mongoose schema are actually parsed as one.
      if (looksLikeMongooseSource(content)) mongoose.push(parseMongooseFile(path, content));
    }
  }

  const graph = buildSchemaGraph({ prisma, sql, mongoose });

  // Truncation can originate upstream of the graph itself — GitHub's own
  // tree truncation, or the shared `maxSourceFiles` limit leaving some
  // candidate schema files unselected — not only from `buildSchemaGraph`'s
  // own model/field/edge caps. `graph.warnings` only ever explains the
  // latter, so the former gets its own honest explanation here rather than
  // leaving `truncated: true` unexplained.
  const upstreamTruncated = snapshot.truncated || skipped > 0 || acquisition.truncated;
  const warnings = [...graph.warnings];
  if (upstreamTruncated && !graph.truncated) {
    warnings.push(
      "Not every candidate source file was analyzed because a repository-wide analysis limit was reached, so this schema may be incomplete."
    );
  }

  const result: SchemaAnalysis = {
    repository: snapshot.repository,
    providers: graph.providers,
    schemas: graph.schemas,
    relationships: graph.relationships,
    nodes: graph.nodes,
    edges: graph.edges,
    stats: graph.stats,
    warnings,
    truncated: upstreamTruncated || graph.truncated,
    ...(graph.truncationReason !== undefined ? { truncationReason: graph.truncationReason } : {}),
  };

  schemaCache.set(key, result);
  return result;
}
