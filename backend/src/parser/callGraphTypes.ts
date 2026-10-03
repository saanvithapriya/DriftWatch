import type { CallGraphFunctionKind } from "../types/callGraph.js";

/**
 * Internal (parser-layer) call graph types.
 *
 * These never cross the API boundary directly — `callGraphBuilder` turns them
 * into the plain `CallGraphAnalysis` DTO. Keeping them separate lets the
 * extractor and resolver carry bookkeeping (bindings, export tables) that the
 * frontend has no business seeing.
 */

export interface ExtractedFunction {
  /** Deterministic id, see functionExtractor.ts for the exact scheme. */
  id: string;
  file: string;
  name: string;
  displayName: string;
  startLine: number;
  endLine: number;
  kind: CallGraphFunctionKind;
  exported: boolean;
  isDefaultExport: boolean;
}

/** How a local name maps to something outside this file. */
export type ImportBindingKind = "named" | "default" | "namespace";

export interface ImportBinding {
  kind: ImportBindingKind;
  /** Module specifier exactly as written, e.g. `./utils`. */
  specifier: string;
  /** Original exported name; absent for a default or namespace import. */
  importedName?: string;
}

/** An export this file makes available under `name`. */
export type ExportEntry =
  | { kind: "function"; functionId: string }
  | { kind: "re-export"; specifier: string; originalName: string };

/** A raw, unresolved call site discovered while walking one file. */
export interface RawCallSite {
  /** Function id of the enclosing function; absent for module-level calls. */
  containingFunctionId: string | null;
  /** The class whose `this` is in scope here, for `this.method()` resolution. */
  containingClassName: string | null;
  callee: CalleeExpression;
  /** Source text of the call expression, already length-clamped. */
  text: string;
  line: number;
  /** True when this call site is a callback reference, not a direct invocation. */
  isCallback: boolean;
}

/** A statically describable callee shape. Anything else is unresolved. */
export type CalleeExpression =
  | { kind: "identifier"; name: string }
  | { kind: "member"; objectName: string; property: string }
  | { kind: "this-member"; property: string }
  | { kind: "other" };

export interface FileFunctionIndex {
  file: string;
  functions: ExtractedFunction[];
  /** Local name -> function id, for same-file functions and simple bindings. */
  bindings: Map<string, string>;
  /** Local object name -> (method name -> function id), for `const o = { m() {} }`. */
  objectMethodTables: Map<string, Map<string, string>>;
  /** Class name -> (method name -> function id), for `this.method()` resolution. */
  classMethodTables: Map<string, Map<string, string>>;
  /** Class name -> constructor function id, for `new ClassName()`. */
  classConstructors: Map<string, string>;
  /** Local name -> where it was imported from. */
  importBindings: Map<string, ImportBinding>;
  /** Exported name -> what it refers to. */
  exports: Map<string, ExportEntry>;
  /** `export default ...`, when present. */
  defaultExport: ExportEntry | null;
  /** `export * from "./x"` specifiers, resolved lazily one hop at a time. */
  wildcardReexports: string[];
  callSites: RawCallSite[];
  /** True when the file could not be parsed at all. */
  failed: boolean;
}
