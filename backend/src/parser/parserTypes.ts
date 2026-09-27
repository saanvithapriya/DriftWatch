/**
 * Application-level parser types.
 *
 * Tree-sitter's AST types never cross this boundary: everything leaving the
 * parser is plain data. The parser also never sees a request, a session, a
 * user or a GitHub credential — it is handed source text and returns
 * structured facts about it.
 */

/** Languages with a Tree-sitter grammar wired up. */
export type SupportedLanguage = "javascript" | "jsx" | "typescript" | "tsx";

/** How a module specifier was written. */
export type ImportKind = "static" | "dynamic" | "require" | "export-from";

export interface ExtractedImport {
  /** Exactly as written in the source, e.g. `./components/Header`. */
  specifier: string;
  kind: ImportKind;
}

export interface SourceFile {
  /** POSIX repository path, e.g. `src/App.tsx`. */
  path: string;
  content: string;
}

export interface ParseResult {
  path: string;
  language: SupportedLanguage;
  imports: ExtractedImport[];
  /** True when the file could not be parsed at all and was skipped. */
  failed: boolean;
}

/** How a specifier was classified once resolved against the repository. */
export type DependencyKind = "internal" | "external" | "unresolved";

export interface ResolvedDependency {
  /** Repository path of the importing file. */
  from: string;
  specifier: string;
  kind: DependencyKind;
  /** Repository path of the imported file; only set when kind is "internal". */
  to?: string;
}
