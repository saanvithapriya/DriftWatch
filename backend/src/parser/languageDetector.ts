import type { SupportedLanguage } from "./parserTypes.js";

/**
 * Extension to grammar. Deterministic and deliberately conservative: a file
 * whose extension is not listed here is skipped rather than guessed at, so a
 * Python or Go file is never parsed as JavaScript.
 */
const EXTENSION_LANGUAGES: ReadonlyMap<string, SupportedLanguage> = new Map([
  [".js", "javascript"],
  [".jsx", "jsx"],
  [".ts", "typescript"],
  [".tsx", "tsx"],
]);

export const SUPPORTED_EXTENSIONS: readonly string[] = [...EXTENSION_LANGUAGES.keys()];

/** Returns the grammar for a path, or null when the file is not supported. */
export function detectLanguage(path: string): SupportedLanguage | null {
  const lastDot = path.lastIndexOf(".");
  if (lastDot <= 0) return null;

  const extension = path.slice(lastDot).toLowerCase();
  return EXTENSION_LANGUAGES.get(extension) ?? null;
}

export function isSupportedSourceFile(path: string): boolean {
  return detectLanguage(path) !== null;
}
