import type { SyntaxNode } from "tree-sitter";
import { detectLanguage } from "./languageDetector.js";
import { parseSource } from "./treeSitterParser.js";
import type {
  CalleeExpression,
  ExportEntry,
  ExtractedFunction,
  FileFunctionIndex,
  ImportBinding,
  RawCallSite,
} from "./callGraphTypes.js";

/**
 * Static function and call-site extraction, per file.
 *
 * Pure and read-only over Tree-sitter's tree: this module never executes
 * source code, never evaluates an expression, and only ever describes what is
 * written. Cross-file resolution (imports, re-exports, the eventual call
 * graph edges) happens one layer up, in `callGraphBuilder.ts` — this module
 * only ever sees one file at a time, exactly like `dependencyExtractor.ts`.
 */

const MAX_TEXT_LENGTH = 200;
/**
 * Recursion is bounded rather than iterative here, unlike
 * `dependencyExtractor`'s flat import walk — tracking the enclosing function
 * and class context through nested scopes is materially simpler as a real
 * call stack. The depth guard, together with the try/catch in
 * `analyzeFunctionsAndCalls`, protects against a pathologically nested file
 * (Security section 20): a file that would recurse past this depth fails
 * closed and is reported as a parse failure, exactly like a file Tree-sitter
 * itself cannot parse.
 */
const MAX_WALK_DEPTH = 400;

function clamp(text: string, max = MAX_TEXT_LENGTH): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max)}…`;
}

function isFunctionBearing(type: string): boolean {
  return (
    type === "function_declaration" ||
    type === "function_expression" ||
    type === "generator_function_declaration" ||
    type === "generator_function" ||
    type === "arrow_function" ||
    type === "method_definition"
  );
}

/**
 * A class field (`handleClick = () => {}`). The plain JavaScript/JSX grammar
 * calls this node `field_definition`; the TypeScript/TSX grammar (which adds
 * optional modifiers such as `private`) calls the same shape
 * `public_field_definition`. Both are checked everywhere a class property is
 * recognised, so class-property functions extract identically in `.js`/`.jsx`
 * and `.ts`/`.tsx`.
 */
function isClassFieldDefinition(type: string | undefined): boolean {
  return type === "field_definition" || type === "public_field_definition";
}

/**
 * A class field's own name. The TypeScript grammar's `public_field_definition`
 * exposes it under the field `name`; the plain JavaScript grammar's
 * `field_definition` exposes the identical position under `property` instead.
 */
function classFieldName(fieldNode: SyntaxNode): SyntaxNode | null {
  return fieldNode.childForFieldName("name") ?? fieldNode.childForFieldName("property");
}

function specifierFrom(stringNode: SyntaxNode | null): string | null {
  if (stringNode === null || stringNode.type !== "string") return null;
  for (const child of stringNode.namedChildren) {
    if (child.type === "string_fragment") return child.text;
  }
  return stringNode.text.length === 2 ? "" : null;
}

function sourceSpecifier(node: SyntaxNode): string | null {
  return specifierFrom(node.childForFieldName("source"));
}

/**
 * Walks up the tree to see whether a node is reached through an `export`,
 * without crossing another function's boundary first — a variable declared
 * inside an exported function's body is not itself exported just because its
 * enclosing function is (e.g. a helper arrow defined inside `export default
 * function App() { const onClick = () => {}; ... }`).
 */
function exportContext(node: SyntaxNode): { exported: boolean; isDefault: boolean } {
  let current: SyntaxNode | null = node.parent;
  let guard = 0;
  while (current !== null && guard < MAX_WALK_DEPTH) {
    if (isFunctionBearing(current.type)) return { exported: false, isDefault: false };
    if (current.type === "export_statement") {
      return {
        exported: true,
        isDefault: /^export\s+default\b/.test(current.text),
      };
    }
    current = current.parent;
    guard += 1;
  }
  return { exported: false, isDefault: false };
}

/** Property or identifier name a member expression's tail refers to, if simple. */
function propertyName(node: SyntaxNode): string | null {
  if (node.type === "property_identifier" || node.type === "identifier") {
    return node.text;
  }
  return null;
}

/**
 * The best available name for a function-bearing node with no name of its
 * own (an arrow function, or an anonymous function expression). Returns null
 * when nothing in the immediate surrounding syntax gives it a stable
 * identity — the caller then falls back to a line-anchored id.
 */
function nameFromContext(node: SyntaxNode): string | null {
  const parent = node.parent;
  if (parent === null) return null;

  if (parent.type === "variable_declarator" && parent.childForFieldName("value") === node) {
    const name = parent.childForFieldName("name");
    return name !== null && name.type === "identifier" ? name.text : null;
  }

  if (parent.type === "pair" && parent.childForFieldName("value") === node) {
    const key = parent.childForFieldName("key");
    return key !== null ? propertyName(key) ?? specifierFrom(key) : null;
  }

  if (isClassFieldDefinition(parent.type) && parent.childForFieldName("value") === node) {
    const name = classFieldName(parent);
    return name !== null ? propertyName(name) : null;
  }

  if (parent.type === "assignment_expression" && parent.childForFieldName("right") === node) {
    const left = parent.childForFieldName("left");
    if (left === null) return null;
    if (left.type === "identifier") return left.text;
    if (left.type === "member_expression") {
      const property = left.childForFieldName("property");
      return property !== null ? propertyName(property) : null;
    }
    return null;
  }

  if (parent.type === "export_statement") {
    return "default";
  }

  if (parent.type === "arguments") {
    return "callback";
  }

  return null;
}

/**
 * The nearest enclosing class's name, when this function is one of its
 * members — either a `method_definition` (parent is the class body directly)
 * or a class-property arrow/function (`handleClick = () => {}`, parent is a
 * `public_field_definition` whose own parent is the class body).
 */
function classNameOf(node: SyntaxNode): string | null {
  const parent = node.parent;
  const classBody =
    parent !== null && isClassFieldDefinition(parent.type) ? parent.parent : parent;
  if (classBody === null || classBody === undefined || classBody.type !== "class_body") {
    return null;
  }
  const classDeclaration = classBody.parent;
  if (classDeclaration === null) return null;
  const name = classDeclaration.childForFieldName("name");
  return name !== null ? name.text : null;
}

interface WalkContext {
  containingFunctionId: string | null;
  /** The class whose `this` is currently in scope, or null. Cleared on entry
   *  into an ordinary function/method (which rebinds `this`) and preserved
   *  through arrow functions (which do not). */
  currentClassName: string | null;
}

class Extractor {
  readonly file: string;
  readonly functions: ExtractedFunction[] = [];
  readonly bindings = new Map<string, string>();
  readonly objectMethodTables = new Map<string, Map<string, string>>();
  readonly classMethodTables = new Map<string, Map<string, string>>();
  readonly classConstructors = new Map<string, string>();
  readonly importBindings = new Map<string, ImportBinding>();
  readonly exports = new Map<string, ExportEntry>();
  readonly wildcardReexports: string[] = [];
  readonly callSites: RawCallSite[] = [];
  defaultExport: ExportEntry | null = null;
  private pendingDefaultIdentifier: string | null = null;

  private readonly usedIds = new Set<string>();

  constructor(file: string) {
    this.file = file;
  }

  private uniqueId(base: string, isStable: boolean, line: number): string {
    let id = isStable ? `${this.file}::${base}` : `${this.file}::${base}@${line}`;
    if (!this.usedIds.has(id)) {
      this.usedIds.add(id);
      return id;
    }
    // A name collision within the same file (two same-named methods in two
    // classes, two anonymous callbacks on one line, …). Line-anchoring first,
    // then a counter — both deterministic given the file's own content.
    const withLine = `${this.file}::${base}@${line}`;
    if (!this.usedIds.has(withLine)) {
      this.usedIds.add(withLine);
      return withLine;
    }
    let counter = 2;
    while (this.usedIds.has(`${withLine}#${counter}`)) counter += 1;
    id = `${withLine}#${counter}`;
    this.usedIds.add(id);
    return id;
  }

  private registerExportIfAny(fn: ExtractedFunction, localName: string | null): void {
    if (!fn.exported || localName === null) return;
    this.exports.set(localName, { kind: "function", functionId: fn.id });
    if (fn.isDefaultExport) this.defaultExport = { kind: "function", functionId: fn.id };
  }

  private calleeOf(node: SyntaxNode, field: "function" | "constructor"): CalleeExpression {
    const callee = node.childForFieldName(field);
    if (callee === null) return { kind: "other" };

    if (callee.type === "identifier") {
      return { kind: "identifier", name: callee.text };
    }

    if (callee.type === "member_expression") {
      const object = callee.childForFieldName("object");
      const property = callee.childForFieldName("property");
      if (object === null || property === null) return { kind: "other" };
      const propName = propertyName(property);
      if (propName === null) return { kind: "other" };

      if (object.type === "this") return { kind: "this-member", property: propName };
      if (object.type === "identifier") return { kind: "member", objectName: object.text, property: propName };
      return { kind: "other" };
    }

    return { kind: "other" };
  }

  private recordCall(node: SyntaxNode, ctx: WalkContext): void {
    const isNew = node.type === "new_expression";
    const callee = this.calleeOf(node, isNew ? "constructor" : "function");
    const isAwaited = node.parent?.type === "await_expression";
    const text = clamp(isAwaited ? `await ${node.text}` : node.text, 150);
    const line = node.startPosition.row + 1;

    this.callSites.push({
      containingFunctionId: ctx.containingFunctionId,
      containingClassName: ctx.currentClassName,
      callee,
      text,
      line,
      isCallback: false,
    });

    // Callback heuristic (spec section 6/8): a bare identifier passed as an
    // argument to this call is recorded as a possible call target too, since
    // `items.map(transform)` and `Promise.resolve().then(handle)` invoke it.
    // Resolution silently drops anything that does not resolve — this never
    // asserts an edge exists, it only opportunistically adds one when it can
    // be confirmed, so it can never fabricate an internal edge.
    const args = node.childForFieldName("arguments");
    if (args !== null) {
      for (const arg of args.namedChildren) {
        if (arg.type !== "identifier") continue;
        this.callSites.push({
          containingFunctionId: ctx.containingFunctionId,
          containingClassName: ctx.currentClassName,
          callee: { kind: "identifier", name: arg.text },
          text: clamp(`${arg.text} (passed to ${callee.kind === "other" ? "call" : text})`, 150),
          line: arg.startPosition.row + 1,
          isCallback: true,
        });
      }
    }
  }

  private extractImportStatement(node: SyntaxNode): void {
    const specifier = sourceSpecifier(node);
    if (specifier === null) return;

    const clause = node.namedChildren.find((c) => c.type === "import_clause");
    if (clause === undefined) return;

    for (const child of clause.namedChildren) {
      if (child.type === "identifier") {
        this.importBindings.set(child.text, { kind: "default", specifier });
      } else if (child.type === "namespace_import") {
        const name = child.namedChildren[0];
        if (name !== undefined && name.type === "identifier") {
          this.importBindings.set(name.text, { kind: "namespace", specifier });
        }
      } else if (child.type === "named_imports") {
        for (const specifierNode of child.namedChildren) {
          if (specifierNode.type !== "import_specifier") continue;
          const nameNode = specifierNode.childForFieldName("name");
          const aliasNode = specifierNode.childForFieldName("alias");
          if (nameNode === null) continue;
          const localName = aliasNode !== null ? aliasNode.text : nameNode.text;
          this.importBindings.set(localName, {
            kind: "named",
            specifier,
            importedName: nameNode.text,
          });
        }
      }
    }
  }

  private extractExportStatement(node: SyntaxNode): void {
    const specifier = sourceSpecifier(node);
    if (specifier === null) return; // a local export; handled via exportContext instead

    const clause = node.namedChildren.find((c) => c.type === "export_clause");
    if (clause === undefined) {
      // `export * from "./x"` — resolved lazily against the target's own
      // export table, one hop, the same as a named re-export.
      this.wildcardReexports.push(specifier);
      return;
    }

    for (const specifierNode of clause.namedChildren) {
      if (specifierNode.type !== "export_specifier") continue;
      const nameNode = specifierNode.childForFieldName("name");
      const aliasNode = specifierNode.childForFieldName("alias");
      if (nameNode === null) continue;
      const localExportName = aliasNode !== null ? aliasNode.text : nameNode.text;
      this.exports.set(localExportName, {
        kind: "re-export",
        specifier,
        originalName: nameNode.text,
      });
    }
  }

  /** `export default someIdentifier;` — resolved once all bindings are known. */
  private noteDefaultIdentifierExport(node: SyntaxNode): void {
    const value = node.childForFieldName("value");
    if (value !== null && value.type === "identifier") {
      this.pendingDefaultIdentifier = value.text;
    }
  }

  private visitFunction(node: SyntaxNode, ctx: WalkContext, depth: number): void {
    const line = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const className = classNameOf(node);
    const isClassMember = className !== null;
    const isConstructor =
      isClassMember && node.type === "method_definition" &&
      propertyName(node.childForFieldName("name") ?? node) === "constructor";

    let ownName: string | null = null;
    if (node.type === "method_definition") {
      const nameField = node.childForFieldName("name");
      ownName = nameField !== null ? propertyName(nameField) : null;
    } else if (node.parent !== null && isClassFieldDefinition(node.parent.type)) {
      // A class-property function (`handleClick = () => {}`) takes its name
      // from the field, not from the arrow/function node, which has none.
      const nameField = classFieldName(node.parent);
      ownName = nameField !== null ? propertyName(nameField) : null;
    } else {
      const nameField = node.childForFieldName("name");
      ownName = nameField !== null && nameField.type === "identifier" ? nameField.text : null;
    }

    const objectLocalName = this.enclosingObjectLocalName(node);
    const contextName = ownName ?? nameFromContext(node);
    // "default" and "callback" are placeholders nameFromContext falls back to
    // when nothing better is available — real enough to display, but not a
    // stable, collision-resistant identifier to build an id or a table key
    // from, so they never count as an "effective name" below.
    const isRealContextName =
      contextName !== null && contextName !== "default" && contextName !== "callback";
    const effectiveName = ownName ?? (isRealContextName ? contextName : null);

    const stableBase =
      isClassMember && effectiveName !== null
        ? `${className}.${effectiveName}`
        : objectLocalName !== null && effectiveName !== null
          ? `${objectLocalName}.${effectiveName}`
          : effectiveName;

    const isStable = stableBase !== null;
    const base = stableBase ?? contextName ?? "anonymous";
    const id = this.uniqueId(base, isStable, line);

    const { exported, isDefault } = isClassMember ? { exported: false, isDefault: false } : exportContext(node);

    const kind = isConstructor
      ? "constructor"
      : node.type === "method_definition"
        ? "method"
        : isClassFieldDefinition(node.parent?.type)
          ? "class-property-function"
          : node.type === "arrow_function"
            ? "arrow-function"
            : node.type === "function_expression" || node.type === "generator_function"
              ? "function-expression"
              : "function-declaration";

    const displayName = isStable ? base : `${base} (line ${line})`;

    const fn: ExtractedFunction = {
      id,
      file: this.file,
      name: effectiveName ?? "anonymous",
      displayName,
      startLine: line,
      endLine,
      kind,
      exported,
      isDefaultExport: isDefault,
    };
    this.functions.push(fn);

    // Bindings, for same-file call resolution.
    if (!isClassMember) {
      if (objectLocalName !== null && effectiveName !== null) {
        let table = this.objectMethodTables.get(objectLocalName);
        if (table === undefined) {
          table = new Map();
          this.objectMethodTables.set(objectLocalName, table);
        }
        table.set(effectiveName, id);
      } else if (effectiveName !== null) {
        this.bindings.set(effectiveName, id);
        this.registerExportIfAny(fn, effectiveName);
      }
    } else if (className !== null && effectiveName !== null) {
      let table = this.classMethodTables.get(className);
      if (table === undefined) {
        table = new Map();
        this.classMethodTables.set(className, table);
      }
      table.set(effectiveName, id);
      if (isConstructor) this.classConstructors.set(className, id);
    }

    // `this` stays bound to the class through arrow functions, but an
    // ordinary nested function/method establishes its own `this`.
    const nextClassName =
      node.type === "arrow_function" ? ctx.currentClassName : className;

    this.visitChildren(node, { containingFunctionId: id, currentClassName: nextClassName }, depth);
  }

  /** True when `node` is a method/property whose value sits directly inside
   *  an object literal that is itself bound to a local `const`/`let`/`var`. */
  private enclosingObjectLocalName(node: SyntaxNode): string | null {
    const container = node.parent; // `pair` or the object itself (method_definition's parent)
    const object = container?.type === "object" ? container : container?.parent;
    if (object === undefined || object === null || object.type !== "object") return null;
    const declarator = object.parent;
    if (declarator === null || declarator.type !== "variable_declarator") return null;
    if (declarator.childForFieldName("value") !== object) return null;
    const name = declarator.childForFieldName("name");
    return name !== null && name.type === "identifier" ? name.text : null;
  }

  private visitChildren(node: SyntaxNode, ctx: WalkContext, depth: number): void {
    if (depth >= MAX_WALK_DEPTH) return;
    for (const child of node.namedChildren) {
      this.visit(child, ctx, depth + 1);
    }
  }

  visit(node: SyntaxNode, ctx: WalkContext, depth: number): void {
    if (depth >= MAX_WALK_DEPTH) return;

    switch (node.type) {
      case "import_statement":
        this.extractImportStatement(node);
        return;

      case "export_statement":
        this.extractExportStatement(node);
        this.noteDefaultIdentifierExport(node);
        this.visitChildren(node, ctx, depth);
        return;

      case "call_expression":
      case "new_expression":
        this.recordCall(node, ctx);
        this.visitChildren(node, ctx, depth);
        return;

      case "class_declaration": {
        // Descend first: the constructor (if any) is only registered in
        // `classConstructors` once its `method_definition` has been visited.
        this.visitChildren(node, ctx, depth);
        const nameNode = node.childForFieldName("name");
        const className = nameNode !== null ? nameNode.text : null;
        if (className !== null) {
          const ctor = this.classConstructors.get(className);
          if (ctor !== undefined) {
            const { exported, isDefault } = exportContext(node);
            if (exported) {
              // Lets `import { ClassName } from "./x"; new ClassName()` and
              // a default-exported class both resolve to its constructor.
              this.exports.set(className, { kind: "function", functionId: ctor });
              if (isDefault) this.defaultExport = { kind: "function", functionId: ctor };
            }
          }
        }
        return;
      }

      default:
        if (isFunctionBearing(node.type)) {
          this.visitFunction(node, ctx, depth);
          return;
        }
        this.visitChildren(node, ctx, depth);
    }
  }

  finish(): FileFunctionIndex {
    if (this.pendingDefaultIdentifier !== null && this.defaultExport === null) {
      const target = this.bindings.get(this.pendingDefaultIdentifier);
      if (target !== undefined) {
        this.defaultExport = { kind: "function", functionId: target };
      } else {
        const ctor = this.classConstructors.get(this.pendingDefaultIdentifier);
        if (ctor !== undefined) this.defaultExport = { kind: "function", functionId: ctor };
      }
    }

    return {
      file: this.file,
      functions: this.functions,
      bindings: this.bindings,
      objectMethodTables: this.objectMethodTables,
      classMethodTables: this.classMethodTables,
      classConstructors: this.classConstructors,
      importBindings: this.importBindings,
      exports: this.exports,
      defaultExport: this.defaultExport,
      wildcardReexports: this.wildcardReexports,
      callSites: this.callSites,
      failed: false,
    };
  }
}

/**
 * Extracts every function, local binding, import, export and call site from
 * one source file. Never throws: a file that cannot be parsed, or one whose
 * nesting is deep enough to trip the recursion guard, comes back with
 * `failed: true` and nothing else, exactly like `analyzeSourceFile` — one bad
 * file must never stop a repository being analyzed.
 */
export function analyzeFunctionsAndCalls(path: string, content: string): FileFunctionIndex {
  const empty: FileFunctionIndex = {
    file: path,
    functions: [],
    bindings: new Map(),
    objectMethodTables: new Map(),
    classMethodTables: new Map(),
    classConstructors: new Map(),
    importBindings: new Map(),
    exports: new Map(),
    defaultExport: null,
    wildcardReexports: [],
    callSites: [],
    failed: true,
  };

  const language = detectLanguage(path);
  if (language === null) return empty;

  const tree = parseSource(language, content);
  if (tree === null) return empty;

  try {
    const extractor = new Extractor(path);
    extractor.visit(tree.rootNode, { containingFunctionId: null, currentClassName: null }, 0);
    return extractor.finish();
  } catch {
    return empty;
  }
}

export { MAX_WALK_DEPTH };
