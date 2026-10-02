import { resolveDependency } from "./dependencyResolver.js";
import type { ExportEntry, FileFunctionIndex, RawCallSite } from "./callGraphTypes.js";

/**
 * Static call resolution across files.
 *
 * Reuses the Phase 4 import resolver (`resolveDependency`) verbatim for every
 * module-specifier lookup — this module never re-implements path resolution,
 * it only adds the function-level lookup on top: given a resolved target
 * file, which of its exported functions (if any) does a name refer to.
 *
 * Never guesses: a callee shape this module does not recognise, or a name
 * that does not appear in a target file's export table, is reported as
 * unresolved rather than linked to the nearest plausible function.
 */

export type ResolvedCallee =
  | { kind: "internal"; targetId: string }
  | { kind: "external" }
  | { kind: "unresolved" };

export interface ResolverContext {
  repositoryFiles: ReadonlySet<string>;
  aliases: ReadonlyMap<string, string>;
  fileIndexByPath: ReadonlyMap<string, FileFunctionIndex>;
}

/** Re-export chains are followed at most this many hops, guarding a cycle
 *  such as two files re-exporting the same name from one another. */
const MAX_REEXPORT_HOPS = 6;

function exportEntryFor(index: FileFunctionIndex, name: string): ExportEntry | null {
  const direct = index.exports.get(name);
  if (direct !== undefined) return direct;
  if (name === "default" && index.defaultExport !== null) return index.defaultExport;
  return null;
}

/** Resolves `name` exported from `file`, following re-exports and `export *`. */
function resolveExportedName(
  ctx: ResolverContext,
  file: string,
  name: string,
  hopsLeft: number
): string | null {
  if (hopsLeft <= 0) return null;
  const index = ctx.fileIndexByPath.get(file);
  if (index === undefined) return null;

  const entry = exportEntryFor(index, name);
  if (entry !== null) {
    if (entry.kind === "function") return entry.functionId;

    const outcome = resolveDependency(file, entry.specifier, {
      files: ctx.repositoryFiles,
      aliases: ctx.aliases,
    });
    if (outcome.kind !== "internal" || outcome.target === undefined) return null;
    return resolveExportedName(ctx, outcome.target, entry.originalName, hopsLeft - 1);
  }

  if (name === "default") return null; // `export *` never re-exports a default

  for (const specifier of index.wildcardReexports) {
    const outcome = resolveDependency(file, specifier, {
      files: ctx.repositoryFiles,
      aliases: ctx.aliases,
    });
    if (outcome.kind === "internal" && outcome.target !== undefined) {
      const found = resolveExportedName(ctx, outcome.target, name, hopsLeft - 1);
      if (found !== null) return found;
    }
  }

  return null;
}

/** Resolves a module specifier, classifying it the same way as Phase 4. */
function resolveModule(
  ctx: ResolverContext,
  fromFile: string,
  specifier: string
): { kind: "internal"; file: string } | { kind: "external" } | { kind: "unresolved" } {
  const outcome = resolveDependency(fromFile, specifier, {
    files: ctx.repositoryFiles,
    aliases: ctx.aliases,
  });
  if (outcome.kind === "internal" && outcome.target !== undefined) {
    return { kind: "internal", file: outcome.target };
  }
  if (outcome.kind === "external") return { kind: "external" };
  return { kind: "unresolved" };
}

function resolveIdentifierCallee(
  ctx: ResolverContext,
  file: string,
  index: FileFunctionIndex,
  name: string
): ResolvedCallee {
  // Priority 1/2: a same-file function or a simple local binding to one.
  const local = index.bindings.get(name) ?? index.classConstructors.get(name);
  if (local !== undefined) return { kind: "internal", targetId: local };

  // Priority 3/4/5: an imported name (named, aliased or default).
  const binding = index.importBindings.get(name);
  if (binding === undefined) return { kind: "unresolved" };
  if (binding.kind === "namespace") return { kind: "unresolved" }; // calling a namespace itself

  const target = resolveModule(ctx, file, binding.specifier);
  if (target.kind === "external") return { kind: "external" };
  if (target.kind === "unresolved") return { kind: "unresolved" };

  const exportedName = binding.kind === "default" ? "default" : binding.importedName ?? name;
  const resolved = resolveExportedName(ctx, target.file, exportedName, MAX_REEXPORT_HOPS);
  return resolved !== null ? { kind: "internal", targetId: resolved } : { kind: "unresolved" };
}

function resolveMemberCallee(
  ctx: ResolverContext,
  file: string,
  index: FileFunctionIndex,
  objectName: string,
  property: string
): ResolvedCallee {
  // Priority 9: a same-file object literal with a statically known method.
  const table = index.objectMethodTables.get(objectName);
  const local = table?.get(property);
  if (local !== undefined) return { kind: "internal", targetId: local };

  const binding = index.importBindings.get(objectName);
  if (binding === undefined) return { kind: "unresolved" };

  const target = resolveModule(ctx, file, binding.specifier);
  if (target.kind === "external") return { kind: "external" };
  if (target.kind === "unresolved") return { kind: "unresolved" };

  // Priority 6: a namespace import (`import * as ns from "./ns"; ns.thing()`).
  // A member access on a default or named import is not modeled further —
  // guessing what shape that value has would not be static analysis.
  if (binding.kind !== "namespace") return { kind: "unresolved" };

  const resolved = resolveExportedName(ctx, target.file, property, MAX_REEXPORT_HOPS);
  return resolved !== null ? { kind: "internal", targetId: resolved } : { kind: "unresolved" };
}

function resolveThisMemberCallee(
  index: FileFunctionIndex,
  className: string | null,
  property: string
): ResolvedCallee {
  // Priority 8: a class method, resolved through the class currently in
  // lexical scope (this module never guesses which instance `this` is).
  if (className === null) return { kind: "unresolved" };
  const table = index.classMethodTables.get(className);
  const target = table?.get(property);
  return target !== undefined ? { kind: "internal", targetId: target } : { kind: "unresolved" };
}

/** Resolves one call site's callee to a function, an external boundary, or nothing. */
export function resolveCallSite(
  ctx: ResolverContext,
  file: string,
  call: RawCallSite
): ResolvedCallee {
  const index = ctx.fileIndexByPath.get(file);
  if (index === undefined) return { kind: "unresolved" };

  switch (call.callee.kind) {
    case "identifier":
      return resolveIdentifierCallee(ctx, file, index, call.callee.name);
    case "member":
      return resolveMemberCallee(ctx, file, index, call.callee.objectName, call.callee.property);
    case "this-member":
      return resolveThisMemberCallee(index, call.containingClassName, call.callee.property);
    case "other":
      return { kind: "unresolved" };
  }
}
