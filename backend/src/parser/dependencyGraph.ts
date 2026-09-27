import type {
  DependencyGraph,
  DependencyGraphEdge,
  DependencyGraphNode,
  DependencyGraphStats,
} from "../types/dependencies.js";
import { collectAliases } from "./aliasConfig.js";
import { analyzeSourceFile } from "./dependencyExtractor.js";
import { resolveDependency } from "./dependencyResolver.js";
import { isSupportedSourceFile } from "./languageDetector.js";

export interface BuildGraphInput {
  /** Every source file selected for analysis: repository path -> contents. */
  sources: ReadonlyMap<string, string>;
  /** Every file path in the repository, used to resolve imports. */
  repositoryFiles: ReadonlySet<string>;
  /** Analysis stopped short of the whole repository. */
  truncated: boolean;
  /** Files that matched a supported extension but were not analyzed. */
  filesSkipped: number;
}

function labelOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

/**
 * Builds the dependency graph from parsed sources.
 *
 * Determinism is a hard requirement, so nothing here depends on object
 * insertion order: nodes and edges are accumulated in maps keyed by their id
 * and then sorted by that id before being returned. Duplicate edges (the same
 * module imported twice in one file) collapse into one.
 *
 * Graph construction is a single pass over the parsed files — there is no
 * traversal of the dependency relation itself, so a dependency cycle simply
 * produces edges in both directions and cannot loop forever.
 */
export function buildDependencyGraph(input: BuildGraphInput): DependencyGraph {
  const { sources, repositoryFiles, truncated, filesSkipped } = input;

  const aliases = collectAliases(sources);
  const nodes = new Map<string, DependencyGraphNode>();
  const edges = new Map<string, DependencyGraphEdge>();

  let filesAnalyzed = 0;
  let filesFailed = 0;
  let internalDependencies = 0;
  let externalImports = 0;
  let unresolvedImports = 0;
  const externalPackages = new Set<string>();

  for (const [path, content] of sources) {
    if (!isSupportedSourceFile(path)) continue;

    const parsed = analyzeSourceFile(path, content);
    if (parsed.failed) {
      filesFailed += 1;
      // A file that could not be parsed is still part of the repository, so it
      // remains a node — it simply contributes no outgoing edges.
      nodes.set(path, { id: path, path, label: labelOf(path), type: "file" });
      continue;
    }

    filesAnalyzed += 1;
    nodes.set(path, { id: path, path, label: labelOf(path), type: "file" });

    for (const imported of parsed.imports) {
      const outcome = resolveDependency(path, imported.specifier, {
        files: repositoryFiles,
        aliases,
      });

      if (outcome.kind === "external") {
        externalImports += 1;
        externalPackages.add(imported.specifier);
        continue;
      }

      if (outcome.kind === "unresolved" || outcome.target === undefined) {
        unresolvedImports += 1;
        continue;
      }

      internalDependencies += 1;

      const target = outcome.target;
      // The target is a real repository file, but it may not have been among
      // the files we analyzed (limits, or an unsupported extension such as a
      // stylesheet). It still belongs in the graph as a node.
      if (!nodes.has(target)) {
        nodes.set(target, {
          id: target,
          path: target,
          label: labelOf(target),
          type: "file",
        });
      }

      // A file importing itself adds nothing.
      if (target === path) continue;

      const id = `${path}->${target}`;
      if (!edges.has(id)) {
        edges.set(id, { id, source: path, target, type: "internal" });
      }
    }
  }

  const stats: DependencyGraphStats = {
    filesAnalyzed,
    filesSkipped,
    filesFailed,
    dependenciesFound: internalDependencies + externalImports + unresolvedImports,
    internalDependencies: edges.size,
    externalImports,
    externalPackages: externalPackages.size,
    unresolvedImports,
    truncated,
  };

  return {
    nodes: [...nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    edges: [...edges.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    stats,
  };
}
