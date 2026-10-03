import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import TypeScriptGrammars from "tree-sitter-typescript";
import type { SupportedLanguage } from "./parserTypes.js";

/**
 * Tree-sitter grammar access.
 *
 * Grammars are opaque native objects, so they are typed as `unknown` here and
 * handed straight to the parser rather than being described inaccurately.
 */
const GRAMMARS: Record<SupportedLanguage, unknown> = {
  // The JavaScript grammar covers JSX syntax as well.
  javascript: JavaScript,
  jsx: JavaScript,
  typescript: TypeScriptGrammars.typescript,
  tsx: TypeScriptGrammars.tsx,
};

/**
 * One parser per language, reused across files. Parsers are stateful but
 * single-threaded here, and constructing one per file is measurably wasteful.
 */
const parsers = new Map<SupportedLanguage, Parser>();

function parserFor(language: SupportedLanguage): Parser {
  let parser = parsers.get(language);
  if (parser === undefined) {
    parser = new Parser();
    parser.setLanguage(GRAMMARS[language] as never);
    parsers.set(language, parser);
  }
  return parser;
}

/**
 * Hard ceiling on a single file. Well above anything the source limits admit,
 * but guards against a pathological file exhausting memory.
 */
const MAX_PARSE_BYTES = 8 * 1024 * 1024;

/**
 * node-tree-sitter throws "Invalid argument" for any source string longer than
 * 32 KB. Feeding the parser through a chunked reader callback instead lifts
 * that limit — without this, every file above 32 KB would silently fail to
 * parse and its imports would vanish from the graph.
 */
const READER_CHUNK_BYTES = 8192;

function chunkedReader(content: string): (index: number) => string | null {
  return (index: number): string | null =>
    index >= content.length
      ? null
      : content.slice(index, index + READER_CHUNK_BYTES);
}

export type SyntaxTree = ReturnType<Parser["parse"]>;

/**
 * Parses source text, returning null when the file cannot be parsed at all.
 *
 * Tree-sitter is error-tolerant: malformed source still produces a tree with
 * ERROR nodes, and the imports it did understand remain extractable. Only a
 * hard failure returns null, and a single bad file must never stop a
 * repository being analyzed.
 */
export function parseSource(
  language: SupportedLanguage,
  content: string
): SyntaxTree | null {
  if (content.length > MAX_PARSE_BYTES) return null;

  try {
    return parserFor(language).parse(
      chunkedReader(content) as never,
      undefined,
      { bufferSize: content.length + 1024 }
    );
  } catch {
    return null;
  }
}
