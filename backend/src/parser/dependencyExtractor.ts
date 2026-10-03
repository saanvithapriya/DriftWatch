import type { SyntaxNode } from "tree-sitter";
import { detectLanguage } from "./languageDetector.js";
import type {
  ExtractedImport,
  ImportKind,
  ParseResult,
  SupportedLanguage,
} from "./parserTypes.js";
import { parseSource } from "./treeSitterParser.js";

/**
 * Reads the text of a module specifier from a `string` node.
 *
 * The node's own text includes the quotes, so the `string_fragment` child is
 * used instead. A template literal or computed expression has no fragment and
 * yields null, which is correct: `require(someVariable)` is not a static
 * dependency and must not be guessed at.
 */
function specifierFrom(stringNode: SyntaxNode | null): string | null {
  if (stringNode === null) return null;
  if (stringNode.type !== "string") return null;

  for (const child of stringNode.namedChildren) {
    if (child.type === "string_fragment") return child.text;
  }

  // An empty string literal has no fragment child.
  return stringNode.text.length === 2 ? "" : null;
}

/** `import ... from "x"` and `export ... from "x"` both use a `source` field. */
function sourceSpecifier(node: SyntaxNode): string | null {
  return specifierFrom(node.childForFieldName("source"));
}

/** First argument of a call, when it is a plain string literal. */
function firstStringArgument(node: SyntaxNode): string | null {
  const args = node.childForFieldName("arguments");
  if (args === null) return null;

  const first = args.namedChildren[0];
  return first === undefined ? null : specifierFrom(first);
}

/**
 * Walks the whole tree collecting module specifiers.
 *
 * Iterative rather than recursive: a deeply nested or pathological file must
 * not be able to blow the call stack, and repository source is untrusted.
 */
export function extractImports(root: SyntaxNode): ExtractedImport[] {
  const imports: ExtractedImport[] = [];
  const stack: SyntaxNode[] = [root];

  const add = (specifier: string | null, kind: ImportKind): void => {
    if (specifier !== null && specifier !== "") {
      imports.push({ specifier, kind });
    }
  };

  while (stack.length > 0) {
    const node = stack.pop() as SyntaxNode;

    switch (node.type) {
      case "import_statement":
        // Covers default, named, aliased, namespace, side-effect and type
        // imports — the grammar gives them all a `source` field.
        add(sourceSpecifier(node), "static");
        break;

      case "export_statement": {
        // Only re-exports carry a source; a plain `export const x` has none.
        const specifier = sourceSpecifier(node);
        if (specifier !== null) add(specifier, "export-from");
        break;
      }

      case "call_expression": {
        const callee = node.childForFieldName("function");
        if (callee !== null) {
          if (callee.type === "import") {
            add(firstStringArgument(node), "dynamic");
          } else if (callee.type === "identifier" && callee.text === "require") {
            add(firstStringArgument(node), "require");
          }
        }
        break;
      }

      default:
        break;
    }

    for (const child of node.namedChildren) {
      stack.push(child);
    }
  }

  return imports;
}

/**
 * Parses one source file and returns the module specifiers it references.
 *
 * Never throws. A file that cannot be parsed is reported as `failed` with no
 * imports, so one malformed file cannot stop a repository being analyzed.
 * Tree-sitter is error-tolerant, so a file with syntax errors normally still
 * yields the imports it did understand.
 */
export function analyzeSourceFile(path: string, content: string): ParseResult {
  const language: SupportedLanguage | null = detectLanguage(path);
  if (language === null) {
    // Callers filter unsupported files out first; this is a safety net.
    return { path, language: "javascript", imports: [], failed: true };
  }

  const tree = parseSource(language, content);
  if (tree === null) {
    return { path, language, imports: [], failed: true };
  }

  try {
    return {
      path,
      language,
      imports: extractImports(tree.rootNode),
      failed: false,
    };
  } catch {
    return { path, language, imports: [], failed: true };
  }
}
