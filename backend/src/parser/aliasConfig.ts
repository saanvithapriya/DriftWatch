/**
 * Path-alias discovery from `tsconfig.json` / `jsconfig.json`.
 *
 * Deliberately conservative. Only the unambiguous shape is honoured:
 *
 *   { "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }
 *
 * A mapping with several targets, no trailing `/*`, or a base that climbs out
 * of the repository is skipped, because guessing would silently attach edges
 * to the wrong files. Anything not resolved this way is reported as
 * `unresolved`, which is honest, rather than invented.
 *
 * Alias support is an enhancement: relative imports never depend on it.
 */
import { normalizeRepositoryPath } from "./dependencyResolver.js";

/** Config files inspected, in priority order. */
export const ALIAS_CONFIG_FILES: readonly string[] = [
  "tsconfig.json",
  "jsconfig.json",
];

/**
 * JSON with comments and trailing commas is common in tsconfig files, and
 * JSON.parse rejects both. This strips them well enough for the `paths` shape
 * we accept; anything it cannot handle simply yields no aliases.
 */
function parseLooseJson(text: string): unknown {
  const withoutComments = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'\\])\/\/.*$/gm, "$1");
  const withoutTrailingCommas = withoutComments.replace(/,(\s*[}\]])/g, "$1");

  try {
    return JSON.parse(withoutTrailingCommas);
  } catch {
    return null;
  }
}

/**
 * Reads alias prefixes from a config file's contents.
 *
 * Returns a map of specifier prefix to repository directory, e.g.
 * `@` -> `src`, so `@/components/Header` becomes `src/components/Header`.
 */
export function readAliases(
  configPath: string,
  contents: string
): Map<string, string> {
  const aliases = new Map<string, string>();
  const parsed = parseLooseJson(contents);
  if (typeof parsed !== "object" || parsed === null) return aliases;

  const compilerOptions = (parsed as { compilerOptions?: unknown })
    .compilerOptions;
  if (typeof compilerOptions !== "object" || compilerOptions === null) {
    return aliases;
  }

  const options = compilerOptions as { baseUrl?: unknown; paths?: unknown };
  if (typeof options.paths !== "object" || options.paths === null) {
    return aliases;
  }

  // The config's own directory anchors baseUrl.
  const configDirectory = configPath.includes("/")
    ? configPath.slice(0, configPath.lastIndexOf("/"))
    : "";
  const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl : ".";
  const base = normalizeRepositoryPath(
    configDirectory === "" ? baseUrl : `${configDirectory}/${baseUrl}`
  );
  if (base === null) return aliases;

  for (const [pattern, targets] of Object.entries(
    options.paths as Record<string, unknown>
  )) {
    // Only the single-target wildcard form is unambiguous.
    if (!Array.isArray(targets) || targets.length !== 1) continue;

    const target = targets[0];
    if (typeof target !== "string") continue;
    if (!pattern.endsWith("/*") || !target.endsWith("/*")) continue;

    const prefix = pattern.slice(0, -2);
    const replacement = normalizeRepositoryPath(
      base === "" ? target.slice(0, -2) : `${base}/${target.slice(0, -2)}`
    );
    if (prefix === "" || replacement === null) continue;

    // First config wins; never overwrite a mapping already established.
    if (!aliases.has(prefix)) aliases.set(prefix, replacement);
  }

  return aliases;
}

/**
 * Collects aliases from whichever supported config files are present,
 * preferring `tsconfig.json` at the repository root.
 */
export function collectAliases(
  sources: ReadonlyMap<string, string>
): Map<string, string> {
  const aliases = new Map<string, string>();

  for (const configFile of ALIAS_CONFIG_FILES) {
    const contents = sources.get(configFile);
    if (contents === undefined) continue;

    for (const [prefix, replacement] of readAliases(configFile, contents)) {
      if (!aliases.has(prefix)) aliases.set(prefix, replacement);
    }
  }

  return aliases;
}
