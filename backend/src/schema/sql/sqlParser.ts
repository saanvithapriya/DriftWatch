import type { SchemaField, SchemaIndex, SchemaModel, SchemaRelationship } from "../../types/schema.js";
import type { ParsedSchemaFile } from "../schemaTypes.js";

/**
 * Static SQL schema parsing — `CREATE TABLE` only (spec section 9).
 *
 * A hand-written parser over a practical subset of common SQL DDL, not a
 * full dialect parser for any particular database. SQL is never executed,
 * and no database connection is ever made; this only reads text. A
 * statement this parser cannot confidently understand is skipped with a
 * warning rather than guessed at.
 */

function clamp(text: string, max = 300): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/** Strips a surrounding `"name"`, `` `name` ``, or `[name]` quoting style. */
function unquoteIdentifier(raw: string): string {
  const trimmed = raw.trim();
  const match = /^["`[](.+)["\]`]$/.exec(trimmed);
  return match !== null ? match[1] : trimmed;
}

/** `schema.table` -> `table` — the schema prefix is not modelled. */
function tableBaseName(raw: string): string {
  const parts = unquoteIdentifier(raw).split(".");
  return unquoteIdentifier(parts[parts.length - 1]);
}

/**
 * Removes `--` and `/* *‍/` comments, respecting single-quoted string
 * literals (so `DEFAULT '--not-a-comment'` is never mistaken for one), and
 * normalizes `''` (SQL's escaped single quote) without breaking string-state
 * tracking.
 */
function stripComments(source: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (inString) {
      out += ch;
      if (ch === "'" && next === "'") {
        out += next;
        i += 1;
        continue;
      }
      if (ch === "'") inString = false;
      continue;
    }

    if (ch === "'") {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "-" && next === "-") {
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
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Extracts the balanced-paren body starting at `openIndex` (which must be `(`). */
function extractParenBody(text: string, openIndex: number): { body: string; end: number } | null {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return { body: text.slice(openIndex + 1, i), end: i };
    }
  }
  return null;
}

/** Splits a column-definition list on top-level commas only (never inside `(...)`). */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") parts.push(current);
  return parts.map((p) => p.trim().replace(/\s+/g, " ")).filter((p) => p !== "");
}

const TABLE_LEVEL_KEYWORDS = /^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CONSTRAINT|KEY|INDEX|CHECK)\b/i;

interface RawRelationship {
  sourceModel: string;
  targetModel: string;
  sourceField?: string;
  targetField: string;
}

interface RawTable {
  name: string;
  fields: SchemaField[];
  indexes: SchemaIndex[];
  relationships: RawRelationship[];
}

function parseColumnDefinition(tableName: string, raw: string): SchemaField | null {
  const match = /^["`[]?([\w]+)["\]`]?\s+([\w]+(?:\s*\([^)]*\))?)\s*(.*)$/.exec(raw);
  if (match === null) return null;

  const [, name, type, rest] = match;
  const hasNotNull = /\bNOT\s+NULL\b/i.test(rest);
  const primaryKey = /\bPRIMARY\s+KEY\b/i.test(rest);
  const unique = /\bUNIQUE\b/i.test(rest);
  const defaultMatch = /\bDEFAULT\s+('(?:[^']|'')*'|\S+)/i.exec(rest);

  const field: SchemaField = {
    id: `${tableName}.${name}`,
    name,
    type: type.replace(/\s+/g, ""),
    nullable: !hasNotNull && !primaryKey,
    primaryKey,
    unique,
    array: false,
  };
  field.required = !field.nullable;
  if (defaultMatch !== null) {
    field.defaultValue = clamp(defaultMatch[1].replace(/^'(.*)'$/, "$1"), 200);
  }

  return field;
}

function fieldList(raw: string): string[] {
  const match = /\(([^)]*)\)/.exec(raw);
  const inner = match !== null ? match[1] : raw;
  return inner
    .split(",")
    .map((s) => unquoteIdentifier(s.trim()))
    .filter((s) => s !== "");
}

function parseTableLevelConstraint(tableName: string, raw: string, table: RawTable, warnings: string[]): void {
  // `CONSTRAINT name ...` — the name itself is not modelled, only what follows.
  const withoutConstraintName = raw.replace(/^CONSTRAINT\s+["`[]?\w+["\]`]?\s+/i, "");

  const pk = /^PRIMARY\s+KEY\s*(\([^)]*\))/i.exec(withoutConstraintName);
  if (pk !== null) {
    const fields = fieldList(pk[1]).sort();
    table.indexes.push({ fields, unique: true });
    for (const field of table.fields) {
      if (fields.includes(field.name)) {
        field.primaryKey = true;
        field.nullable = false;
        field.required = true;
      }
    }
    return;
  }

  const fk = /^FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+["`[]?([\w.]+)["\]`]?\s*(?:\(([^)]*)\))?/i.exec(
    withoutConstraintName
  );
  if (fk !== null) {
    const fkColumns = fieldList(`(${fk[1]})`);
    const refTable = tableBaseName(fk[2]);
    const refColumns = fk[3] !== undefined ? fieldList(`(${fk[3]})`) : [];
    const relationship: RawRelationship = {
      sourceModel: refTable,
      targetModel: tableName,
      targetField: fkColumns[0],
    };
    if (refColumns[0] !== undefined) relationship.sourceField = refColumns[0];
    table.relationships.push(relationship);
    return;
  }

  const uq = /^UNIQUE\s*(?:KEY\s+["`[]?\w+["\]`]?\s*)?\(([^)]*)\)/i.exec(withoutConstraintName);
  if (uq !== null) {
    table.indexes.push({ fields: fieldList(`(${uq[1]})`).sort(), unique: true });
    return;
  }

  const idx = /^(?:KEY|INDEX)\s+["`[]?(\w+)["\]`]?\s*\(([^)]*)\)/i.exec(withoutConstraintName);
  if (idx !== null) {
    table.indexes.push({ name: idx[1], fields: fieldList(`(${idx[2]})`).sort(), unique: false });
    return;
  }

  if (/^CHECK\b/i.test(withoutConstraintName)) return; // recognised, intentionally not modelled

  warnings.push(`Unsupported table-level constraint in "${tableName}": ${clamp(raw, 150)}`);
}

/** Parses every `CREATE TABLE` statement in one `.sql` file. Never throws. */
export function parseSqlSchema(path: string, content: string): ParsedSchemaFile {
  const warnings: string[] = [];

  try {
    const cleaned = stripComments(content);
    const tables: RawTable[] = [];

    const createPattern = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(["`[]?[\w.]+["\]`]?)\s*\(/gi;
    let match: RegExpExecArray | null;
    while ((match = createPattern.exec(cleaned)) !== null) {
      const tableName = tableBaseName(match[1]);
      const openIndex = match.index + match[0].length - 1;
      const extracted = extractParenBody(cleaned, openIndex);
      if (extracted === null) {
        warnings.push(`Table "${tableName}" in ${path} has an unterminated definition and was skipped.`);
        continue;
      }

      const table: RawTable = { name: tableName, fields: [], indexes: [], relationships: [] };
      for (const part of splitTopLevel(extracted.body)) {
        if (TABLE_LEVEL_KEYWORDS.test(part)) {
          parseTableLevelConstraint(tableName, part, table, warnings);
          continue;
        }

        // An inline `col INTEGER REFERENCES other(id)` reference.
        const inlineRef = /\bREFERENCES\s+["`[]?([\w.]+)["\]`]?\s*(?:\(([^)]*)\))?/i.exec(part);
        const field = parseColumnDefinition(tableName, part);
        if (field === null) {
          warnings.push(`Could not parse a column in table "${tableName}": ${clamp(part, 120)}`);
          continue;
        }
        table.fields.push(field);

        if (inlineRef !== null) {
          const refTable = tableBaseName(inlineRef[1]);
          const refColumns = inlineRef[2] !== undefined ? fieldList(`(${inlineRef[2]})`) : [];
          const relationship: RawRelationship = {
            sourceModel: refTable,
            targetModel: tableName,
            targetField: field.name,
          };
          if (refColumns[0] !== undefined) relationship.sourceField = refColumns[0];
          table.relationships.push(relationship);
        }
      }

      tables.push(table);
      createPattern.lastIndex = extracted.end;
    }

    const models: SchemaModel[] = tables.map((t) => ({
      id: `sql:${path}:${t.name}`,
      name: t.name,
      sourceType: "sql",
      sourcePath: path,
      fields: t.fields,
      indexes: t.indexes,
    }));

    // Not restricted to tables defined in this same file: migrations are
    // routinely split across several `.sql` files. Whether a referenced
    // table exists *anywhere* in the repository is checked once, after every
    // file is parsed and merged, in `schemaGraph.ts`.
    const relationships: SchemaRelationship[] = [];
    const seen = new Set<string>();
    for (const table of tables) {
      for (const rel of table.relationships) {
        const id = `${rel.sourceModel}->${rel.targetModel}:${rel.targetField}`;
        if (seen.has(id)) continue;
        seen.add(id);

        const relationship: SchemaRelationship = {
          id,
          sourceModel: rel.sourceModel,
          targetModel: rel.targetModel,
          cardinality: "1:N",
          targetField: rel.targetField,
          inferred: false,
        };
        if (rel.sourceField !== undefined) relationship.sourceField = rel.sourceField;
        relationships.push(relationship);
      }
    }

    return { models, relationships, warnings };
  } catch {
    return {
      models: [],
      relationships: [],
      warnings: [`Failed to parse SQL schema at ${path}; the file was skipped.`],
    };
  }
}

/** True for any `.sql` file. */
export function isSqlSchemaPath(path: string): boolean {
  return path.toLowerCase().endsWith(".sql");
}
