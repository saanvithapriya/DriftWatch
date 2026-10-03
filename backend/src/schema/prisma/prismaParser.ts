import type {
  SchemaCardinality,
  SchemaField,
  SchemaIndex,
  SchemaModel,
  SchemaRelationship,
} from "../../types/schema.js";
import type { ParsedSchemaFile } from "../schemaTypes.js";

/**
 * Static Prisma schema parsing.
 *
 * A hand-written, line-oriented parser over Prisma's own small DSL — not a
 * JSON/YAML dialect, so none of the project's existing parsers apply, and
 * there is no Prisma grammar already a dependency here. The Prisma CLI is
 * never invoked and no `.prisma` file is ever executed; this only reads
 * text and describes what it finds. A malformed model is reported as a
 * warning and skipped; it never stops the rest of the file (or repository)
 * from being analyzed.
 */

const SCALAR_TYPES = new Set([
  "String",
  "Boolean",
  "Int",
  "BigInt",
  "Float",
  "Decimal",
  "DateTime",
  "Json",
  "Bytes",
]);

function isScalarType(type: string): boolean {
  return SCALAR_TYPES.has(type);
}

/** Clamp a field/model name or free-text value to a sane length, defending
 *  against a pathologically huge identifier bloating the response. */
function clamp(text: string, max = 300): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/**
 * Removes `//` and `/* *‍/` comments, respecting double-quoted strings (a
 * default value such as `@default("https://example.com")` must not have its
 * `//` mistaken for a comment start).
 */
function stripComments(source: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (inString) {
      out += ch;
      if (ch === "\\") {
        // Preserve the escaped character verbatim so a trailing `\"` does
        // not prematurely end the string.
        if (next !== undefined) {
          out += next;
          i += 1;
        }
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i += 1;
      }
      i += 1; // consume the closing '/'
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Joins lines whose parentheses span multiple lines into one logical line —
 * handles `@relation(\n  fields: [x],\n  references: [y]\n)` written across
 * several lines, which is otherwise indistinguishable from several fields.
 */
function joinWrappedParens(source: string): string {
  let out = "";
  let depth = 0;
  for (const ch of source) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    out += depth > 0 && ch === "\n" ? " " : ch;
  }
  return out;
}

/** Extracts the balanced-brace body of the first `{` found from `start`. */
function extractBraceBody(text: string, openIndex: number): { body: string; end: number } | null {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return { body: text.slice(openIndex + 1, i), end: i };
    }
  }
  return null;
}

interface PrismaAttribute {
  name: string;
  args: string | null;
}

/** Tokenizes `@attr @attr(args) @@attr(args)` into a flat list, respecting
 *  balanced parens within `args` (e.g. `@default(autoincrement())`). */
function parseAttributes(text: string): PrismaAttribute[] {
  const attributes: PrismaAttribute[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "@") {
      i += 1;
      continue;
    }
    let start = i;
    while (text[start] === "@") start += 1; // `@` or `@@`
    let end = start;
    while (end < text.length && /[\w]/.test(text[end])) end += 1;
    const name = text.slice(i, end);
    i = end;

    let args: string | null = null;
    if (text[i] === "(") {
      let depth = 0;
      const argStart = i;
      for (; i < text.length; i += 1) {
        if (text[i] === "(") depth += 1;
        else if (text[i] === ")") {
          depth -= 1;
          if (depth === 0) {
            i += 1;
            break;
          }
        }
      }
      args = text.slice(argStart + 1, i - 1);
    }
    attributes.push({ name, args });
  }
  return attributes;
}

/** `[a, b, "c"]` -> `["a", "b", "c"]`, unquoting simple string elements. */
function parseList(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined) return [];
  const match = /\[([^\]]*)\]/.exec(raw);
  const inner = match !== null ? match[1] : raw;
  return inner
    .split(",")
    .map((s) => s.trim().replace(/^"(.*)"$/, "$1"))
    .filter((s) => s !== "");
}

/** Named or positional args inside `@relation(...)`: `name`, `fields`, `references`. */
function parseRelationArgs(args: string): {
  name?: string;
  fields: string[];
  references: string[];
} {
  const namedName = /(?:^|,)\s*name\s*:\s*"([^"]*)"/.exec(args);
  const positionalName = /^\s*"([^"]*)"/.exec(args);
  const fieldsMatch = /fields\s*:\s*(\[[^\]]*\])/.exec(args);
  const referencesMatch = /references\s*:\s*(\[[^\]]*\])/.exec(args);

  const result: { name?: string; fields: string[]; references: string[] } = {
    fields: parseList(fieldsMatch?.[1]),
    references: parseList(referencesMatch?.[1]),
  };
  const relationName = namedName?.[1] ?? positionalName?.[1];
  if (relationName !== undefined) result.name = relationName;
  return result;
}

interface ParsedField {
  field: SchemaField;
  /** Present only for a field whose type names another model. */
  relationTarget?: { modelName: string; array: boolean };
  relationAttr?: PrismaAttribute;
  attributes: PrismaAttribute[];
}

function parseFieldLine(
  modelName: string,
  line: string,
  warnings: string[]
): ParsedField | null {
  const match = /^(\w+)\s+([\w.]+)(\[\])?(\?)?\s*(.*)$/.exec(line.trim());
  if (match === null) {
    warnings.push(`Could not parse a field in model "${modelName}": ${clamp(line, 120)}`);
    return null;
  }

  const [, name, baseType, arrayMarker, optionalMarker, rest] = match;
  const attributes = parseAttributes(rest);
  const array = arrayMarker !== undefined;
  const nullable = optionalMarker !== undefined;

  const idAttr = attributes.find((a) => a.name === "@id");
  const uniqueAttr = attributes.find((a) => a.name === "@unique");
  const defaultAttr = attributes.find((a) => a.name === "@default");
  const relationAttr = attributes.find((a) => a.name === "@relation");

  const field: SchemaField = {
    id: `${modelName}.${name}`,
    name,
    type: `${baseType}${array ? "[]" : ""}${nullable ? "?" : ""}`,
    nullable,
    primaryKey: idAttr !== undefined,
    unique: uniqueAttr !== undefined,
    array,
  };
  if (!array) field.required = !nullable;
  if (defaultAttr?.args != null) {
    field.defaultValue = clamp(defaultAttr.args.replace(/^"(.*)"$/, "$1"), 200);
  }

  const result: ParsedField = { field, attributes };
  if (!isScalarType(baseType)) {
    result.relationTarget = { modelName: baseType, array };
  }
  if (relationAttr !== undefined) result.relationAttr = relationAttr;
  return result;
}

interface RawModel {
  name: string;
  fields: ParsedField[];
  blockAttributes: PrismaAttribute[];
}

function parseModelBody(name: string, body: string, warnings: string[]): RawModel {
  const fields: ParsedField[] = [];
  const blockAttributes: PrismaAttribute[] = [];

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;

    if (line.startsWith("@@")) {
      blockAttributes.push(...parseAttributes(line));
      continue;
    }

    const parsed = parseFieldLine(name, line, warnings);
    if (parsed !== null) fields.push(parsed);
  }

  return { name, fields, blockAttributes };
}

function buildIndexesAndCompositeKeys(model: RawModel): SchemaIndex[] {
  const indexes: SchemaIndex[] = [];

  for (const attr of model.blockAttributes) {
    const fields = parseList(attr.args ?? undefined);
    if (fields.length === 0) continue;

    if (attr.name === "@@id") {
      indexes.push({ fields: fields.sort(), unique: true });
      for (const field of model.fields) {
        if (fields.includes(field.field.name)) field.field.primaryKey = true;
      }
    } else if (attr.name === "@@unique") {
      const nameMatch = /name\s*:\s*"([^"]*)"/.exec(attr.args ?? "");
      const index: SchemaIndex = { fields: fields.sort(), unique: true };
      if (nameMatch !== null) index.name = nameMatch[1];
      indexes.push(index);
    } else if (attr.name === "@@index") {
      const nameMatch = /name\s*:\s*"([^"]*)"/.exec(attr.args ?? "");
      const index: SchemaIndex = { fields: fields.sort(), unique: false };
      if (nameMatch !== null) index.name = nameMatch[1];
      indexes.push(index);
    }
  }

  return indexes.sort((a, b) => a.fields.join(",").localeCompare(b.fields.join(",")));
}

/**
 * Relationship extraction (spec sections 8/12/13).
 *
 * Only two shapes ever produce a relationship, deliberately — anything else
 * is left as an ordinary field rather than guessed at:
 *
 *   1. A scalar field carrying `@relation(fields: [...], references: [...])`
 *      fully describes a 1:N (or 1:1, if that field is also unique/id) edge
 *      on its own: sourceModel is the referenced ("one") model, targetModel
 *      is the model holding the foreign key (the "many" side).
 *   2. A pair of plain array-typed relation fields on two different models,
 *      each pointing at the other with no explicit foreign key anywhere —
 *      Prisma's implicit many-to-many — produces one N:M edge, emitted once
 *      and ordered alphabetically since neither side is naturally "first".
 *
 * An array-typed relation field that matches neither shape (its Prisma
 * counterpart `@relation` was not found, e.g. because the referenced model
 * lives in a different file this parser never sees) produces no
 * relationship at all, per "do not invent relationships when the syntax is
 * ambiguous."
 */
function extractRelationships(models: RawModel[]): SchemaRelationship[] {
  const relationships: SchemaRelationship[] = [];
  // Deliberately not restricted to models defined in this same file: Prisma
  // schemas may be split across several `*.prisma` files, and a relation
  // field's target model is frequently declared in a different one. Whether
  // a referenced model exists *anywhere* in the repository is checked once,
  // after every file has been parsed and merged, in `schemaGraph.ts` — a
  // dangling reference is dropped there, with a warning, rather than here.
  const arrayRelationFields = new Map<string, Set<string>>(); // modelName -> target model names (array, no @relation fields/references)
  // A relation `name:` already spoken for by an explicit fields/references
  // relationship — its array-typed counterpart (the readability-only "back
  // relation" field Prisma requires for a named 1:N/1:1) must not also be
  // counted as a second, separate many-to-many pair.
  const explicitRelationNames = new Set<string>();

  // First pass: every explicit (fields/references) relationship, which also
  // records which relation names are already accounted for.
  for (const model of models) {
    for (const parsed of model.fields) {
      if (parsed.relationTarget === undefined) continue;
      const target = parsed.relationTarget.modelName;

      const relArgs = parsed.relationAttr?.args ?? null;
      const { name: relationName, fields: fkFields, references: refFields } =
        relArgs !== null ? parseRelationArgs(relArgs) : { fields: [], references: [] };
      if (fkFields.length === 0 || refFields.length === 0) continue;

      // 1:1 is signalled by the *scalar* foreign-key field (named in
      // `fields: […]`, e.g. `userId`) being unique or the primary key —
      // not by the relation field itself (`user User`), which Prisma never
      // allows `@unique` on in the first place.
      const fkField = model.fields.find((f) => f.field.name === fkFields[0])?.field;
      const isOneToOne = fkField?.unique === true || fkField?.primaryKey === true;
      const cardinality: SchemaCardinality = isOneToOne ? "1:1" : "1:N";
      const relationship: SchemaRelationship = {
        id: `${target}->${model.name}:${fkFields.join("+")}`,
        sourceModel: target,
        targetModel: model.name,
        cardinality,
        sourceField: refFields[0],
        targetField: fkFields[0],
        inferred: false,
      };
      if (relationName !== undefined) {
        relationship.relationName = relationName;
        explicitRelationNames.add(relationName);
      }
      relationships.push(relationship);
    }
  }

  // Second pass: plain array-typed relation fields not already part of an
  // explicit relationship above are candidates for an implicit many-to-many.
  for (const model of models) {
    for (const parsed of model.fields) {
      if (parsed.relationTarget === undefined || !parsed.relationTarget.array) continue;
      const target = parsed.relationTarget.modelName;

      const relArgs = parsed.relationAttr?.args ?? null;
      const { name: relationName, fields: fkFields, references: refFields } =
        relArgs !== null ? parseRelationArgs(relArgs) : { fields: [], references: [] };
      if (fkFields.length > 0 && refFields.length > 0) continue; // handled above
      if (relationName !== undefined && explicitRelationNames.has(relationName)) continue;

      let set = arrayRelationFields.get(model.name);
      if (set === undefined) {
        set = new Set();
        arrayRelationFields.set(model.name, set);
      }
      set.add(target);
    }
  }

  // Implicit many-to-many: both sides have a plain array field pointing at
  // the other, with no scalar foreign key anywhere describing it.
  const seenPairs = new Set<string>();
  for (const [modelA, targets] of arrayRelationFields) {
    for (const modelB of targets) {
      const backRef = arrayRelationFields.get(modelB)?.has(modelA) ?? false;
      if (!backRef) continue;

      const [sourceModel, targetModel] = [modelA, modelB].sort();
      const pairKey = `${sourceModel}<->${targetModel}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      relationships.push({
        id: `${sourceModel}<->${targetModel}`,
        sourceModel,
        targetModel,
        cardinality: "N:M",
        inferred: false,
      });
    }
  }

  return relationships;
}

/** Parses one `.prisma` file. Never throws. */
export function parsePrismaSchema(path: string, content: string): ParsedSchemaFile {
  const warnings: string[] = [];

  try {
    const cleaned = joinWrappedParens(stripComments(content));
    const rawModels: RawModel[] = [];

    const modelPattern = /\bmodel\s+(\w+)\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = modelPattern.exec(cleaned)) !== null) {
      const braceOpen = cleaned.indexOf("{", match.index);
      const body = extractBraceBody(cleaned, braceOpen);
      if (body === null) {
        warnings.push(`Model "${match[1]}" in ${path} has an unterminated block and was skipped.`);
        continue;
      }
      rawModels.push(parseModelBody(match[1], body.body, warnings));
      modelPattern.lastIndex = body.end;
    }

    const models: SchemaModel[] = rawModels.map((raw) => ({
      id: `prisma:${path}:${raw.name}`,
      name: raw.name,
      sourceType: "prisma",
      sourcePath: path,
      fields: raw.fields.map((f) => f.field),
      indexes: buildIndexesAndCompositeKeys(raw),
    }));

    const relationships = extractRelationships(rawModels);

    return { models, relationships, warnings };
  } catch {
    return {
      models: [],
      relationships: [],
      warnings: [`Failed to parse Prisma schema at ${path}; the file was skipped.`],
    };
  }
}

/** True for `schema.prisma`, `prisma/schema.prisma`, and any nested `*.prisma` file. */
export function isPrismaSchemaPath(path: string): boolean {
  return path.toLowerCase().endsWith(".prisma");
}
