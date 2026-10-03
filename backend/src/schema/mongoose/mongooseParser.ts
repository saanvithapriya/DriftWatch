import type { SyntaxNode } from "tree-sitter";
import { detectLanguage } from "../../parser/languageDetector.js";
import { parseSource } from "../../parser/treeSitterParser.js";
import type { SchemaCardinality, SchemaField, SchemaModel, SchemaRelationship } from "../../types/schema.js";
import type { ParsedSchemaFile } from "../schemaTypes.js";

/**
 * Static Mongoose schema parsing, built on Phase 4's Tree-sitter
 * infrastructure (the same `parseSource`/`detectLanguage` every other
 * provider and Phase 4/6 already use — no second parser is introduced).
 *
 * Only deterministic AST shapes are recognised: `new Schema({...})` /
 * `new mongoose.Schema({...})`, and `model("Name", schemaRef)` /
 * `mongoose.model("Name", schemaRef)`. Nothing is executed — this never
 * evaluates a default value, a getter, or any other expression; a shape
 * this module does not recognise is left alone rather than guessed at.
 */

const MAX_WALK_DEPTH = 400;

function clamp(text: string, max = 200): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max)}…`;
}

function stringFragmentText(node: SyntaxNode): string | null {
  if (node.type !== "string") return null;
  for (const child of node.namedChildren) {
    if (child.type === "string_fragment") return child.text;
  }
  return node.text.length === 2 ? "" : null;
}

/** `Schema` (bare) or `<anything>.Schema` (e.g. `mongoose.Schema`). */
function isSchemaConstructor(node: SyntaxNode): boolean {
  if (node.type === "identifier") return node.text === "Schema";
  if (node.type === "member_expression") {
    return node.childForFieldName("property")?.text === "Schema";
  }
  return false;
}

/** `model` (bare) or `<anything>.model` (e.g. `mongoose.model`). */
function isModelCall(node: SyntaxNode): boolean {
  if (node.type === "identifier") return node.text === "model";
  if (node.type === "member_expression") {
    return node.childForFieldName("property")?.text === "model";
  }
  return false;
}

function collectPairs(objectNode: SyntaxNode): Map<string, SyntaxNode> {
  const pairs = new Map<string, SyntaxNode>();
  for (const child of objectNode.namedChildren) {
    if (child.type !== "pair") continue;
    const keyNode = child.childForFieldName("key");
    const valueNode = child.childForFieldName("value");
    if (keyNode === null || valueNode === null) continue;

    const key =
      keyNode.type === "property_identifier"
        ? keyNode.text
        : keyNode.type === "string"
          ? stringFragmentText(keyNode)
          : null;
    if (key === null) continue;
    pairs.set(key, valueNode);
  }
  return pairs;
}

/** Scalar identifier, or a member chain such as `Schema.Types.ObjectId`
 *  (only its last segment, "ObjectId", is kept — that is the part that
 *  actually names the type). Arrays and objects are handled one level up,
 *  in `resolveFieldValue`, which also needs to recurse into them. */
function extractValueShape(node: SyntaxNode): { type: string } | null {
  if (node.type === "identifier") return { type: node.text };
  if (node.type === "member_expression") {
    const property = node.childForFieldName("property")?.text;
    return property !== undefined ? { type: property } : null;
  }
  return null;
}

interface FieldOptions {
  type: string;
  array: boolean;
  required: boolean;
  unique: boolean;
  defaultValue?: string;
  ref?: string;
}

/**
 * Resolves any field-value shape to a full `FieldOptions`: a bare scalar
 * (`String`), a `Types.ObjectId`-style member chain, a detailed options
 * object (`{ type: ..., required: ..., ref: ... }`), or an array wrapping
 * any of those (`[String]`, `[{ type: ObjectId, ref: "Post" }]`) — arrays
 * are unwrapped by recursing into their first element, so `ref`/`required`/
 * `unique`/`enum` are extracted correctly regardless of whether the field
 * is singular or an array. Returns null for a shape this module does not
 * recognise (a dynamic expression, a function call, …) — never guessed at.
 */
function resolveFieldValue(node: SyntaxNode): FieldOptions | null {
  if (node.type === "array") {
    const first = node.namedChildren[0];
    if (first === undefined) return null;
    const inner = resolveFieldValue(first);
    return inner === null ? null : { ...inner, array: true };
  }
  if (node.type === "object") {
    return extractFieldOptions(node);
  }
  const shape = extractValueShape(node);
  return shape === null ? null : { type: shape.type, array: false, required: false, unique: false };
}

/** `{ type: String, required: true, ... }`. Returns null when there is no
 *  `type` key — the caller then knows to treat the object as a nested
 *  subdocument instead of a set of field options. */
function extractFieldOptions(objectNode: SyntaxNode): FieldOptions | null {
  const pairs = collectPairs(objectNode);
  const typeNode = pairs.get("type");
  if (typeNode === undefined) return null;

  const base = resolveFieldValue(typeNode);
  if (base === null) return null;

  const requiredNode = pairs.get("required");
  const uniqueNode = pairs.get("unique");
  const defaultNode = pairs.get("default");
  const refNode = pairs.get("ref");
  const enumNode = pairs.get("enum");

  let type = base.type;
  if (enumNode !== undefined && enumNode.type === "array") {
    const values = enumNode.namedChildren
      .map((c) => stringFragmentText(c))
      .filter((v): v is string => v !== null);
    if (values.length > 0) type = `enum(${values.join("|")})`;
  }

  const options: FieldOptions = {
    type,
    array: base.array,
    required: requiredNode?.type === "true",
    unique: uniqueNode?.type === "true",
  };
  if (defaultNode !== undefined) options.defaultValue = clamp(defaultNode.text);
  if (refNode !== undefined) {
    const refValue = stringFragmentText(refNode);
    if (refValue !== null) options.ref = refValue;
  }
  return options;
}

/**
 * Flattens one schema's field-definition object into `SchemaField`s.
 * Nested subdocuments (`profile: { bio: String, avatar: String }` — an
 * object with no `type` key) are flattened with a dotted prefix rather than
 * represented as their own model, matching the unified, provider-neutral
 * `SchemaField` shape.
 */
function extractFields(modelName: string, fieldsObject: SyntaxNode, prefix = ""): SchemaField[] {
  const fields: SchemaField[] = [];
  const pairs = collectPairs(fieldsObject);

  for (const [key, valueNode] of pairs) {
    const name = prefix === "" ? key : `${prefix}.${key}`;

    if (valueNode.type === "object") {
      const options = extractFieldOptions(valueNode);
      if (options === null) {
        // No `type` key: a nested subdocument, flattened recursively.
        fields.push(...extractFields(modelName, valueNode, name));
        continue;
      }
      fields.push(toSchemaField(modelName, name, options));
      continue;
    }

    const options = resolveFieldValue(valueNode);
    if (options === null) continue; // a dynamic/unrecognised shape — skipped, never guessed at
    fields.push(toSchemaField(modelName, name, options));
  }

  return fields;
}

function toSchemaField(modelName: string, name: string, options: FieldOptions): SchemaField {
  const field: SchemaField = {
    id: `${modelName}.${name}`,
    name,
    type: `${options.type}${options.array ? "[]" : ""}`,
    nullable: !options.required,
    primaryKey: false,
    unique: options.unique,
    array: options.array,
    required: options.required,
  };
  if (options.defaultValue !== undefined) field.defaultValue = options.defaultValue;
  if (options.ref !== undefined) field.references = { model: options.ref };
  return field;
}

interface RawSchema {
  /** The `object` node holding this schema's field definitions. */
  fieldsNode: SyntaxNode;
}

interface RawModelRegistration {
  modelName: string;
  schema: RawSchema | null;
}

/** Extracts the schema (its fields object) directly from a `new Schema(...)`/
 *  `new mongoose.Schema(...)` node, with no dependency on traversal order —
 *  used both to build the variable-name lookup table below and to resolve a
 *  schema passed inline (`model("X", new Schema({...}))`), which a
 *  node-identity map populated during the same walk cannot see yet when the
 *  model-registration call is itself what is currently being visited. */
function schemaFromNewExpression(node: SyntaxNode): RawSchema | null {
  const constructor = node.childForFieldName("constructor");
  if (constructor === null || !isSchemaConstructor(constructor)) return null;
  const args = node.childForFieldName("arguments");
  const fieldsNode = args?.namedChildren.find((c) => c.type === "object");
  return fieldsNode === undefined ? null : { fieldsNode };
}

class Walker {
  readonly schemaByLocalName = new Map<string, RawSchema>();
  readonly registrations: RawModelRegistration[] = [];

  visit(node: SyntaxNode, depth: number): void {
    if (depth >= MAX_WALK_DEPTH) return;

    if (node.type === "new_expression") {
      const schema = schemaFromNewExpression(node);
      if (schema !== null) {
        const parent = node.parent;
        if (parent?.type === "variable_declarator") {
          const nameNode = parent.childForFieldName("name");
          if (nameNode !== null && nameNode.type === "identifier") {
            this.schemaByLocalName.set(nameNode.text, schema);
          }
        }
      }
    }

    if (node.type === "call_expression") {
      const callee = node.childForFieldName("function");
      if (callee !== null && isModelCall(callee)) {
        const args = node.childForFieldName("arguments")?.namedChildren ?? [];
        const nameArg = args[0];
        const schemaArg = args[1];
        const modelName = nameArg !== undefined ? stringFragmentText(nameArg) : null;

        if (modelName !== null) {
          let schema: RawSchema | null = null;
          if (schemaArg !== undefined) {
            if (schemaArg.type === "identifier") {
              schema = this.schemaByLocalName.get(schemaArg.text) ?? null;
            } else if (schemaArg.type === "new_expression") {
              schema = schemaFromNewExpression(schemaArg);
            }
          }
          this.registrations.push({ modelName, schema });
        }
      }
    }

    for (const child of node.namedChildren) this.visit(child, depth + 1);
  }
}

/** Parses one JS/JSX/TS/TSX file for Mongoose model definitions. Never throws. */
export function parseMongooseFile(path: string, content: string): ParsedSchemaFile {
  const language = detectLanguage(path);
  if (language === null) return { models: [], relationships: [], warnings: [] };

  const tree = parseSource(language, content);
  if (tree === null) return { models: [], relationships: [], warnings: [] };

  try {
    const walker = new Walker();
    walker.visit(tree.rootNode, 0);

    const models: SchemaModel[] = [];
    const relationships: SchemaRelationship[] = [];
    const warnings: string[] = [];

    for (const registration of walker.registrations) {
      if (registration.schema === null) {
        warnings.push(
          `Could not resolve the schema passed to model("${registration.modelName}") in ${path}; it was skipped.`
        );
        continue;
      }

      const fields = extractFields(registration.modelName, registration.schema.fieldsNode);
      models.push({
        id: `mongoose:${path}:${registration.modelName}`,
        name: registration.modelName,
        sourceType: "mongoose",
        sourcePath: path,
        fields,
        indexes: [],
      });

      for (const field of fields) {
        if (field.references === undefined) continue;
        const cardinality: SchemaCardinality = field.array ? "unknown" : "1:N";
        relationships.push({
          id: `${field.references.model}->${registration.modelName}:${field.name}`,
          sourceModel: field.references.model,
          targetModel: registration.modelName,
          cardinality,
          targetField: field.name,
          inferred: false,
        });
      }
    }

    return { models, relationships, warnings };
  } catch {
    return {
      models: [],
      relationships: [],
      warnings: [`Failed to parse Mongoose models at ${path}; the file was skipped.`],
    };
  }
}

/**
 * A file is only classified as a Mongoose schema source when it contains a
 * recognisable `Schema(` construct — never every JS/TS file, per spec
 * section 6. This is a cheap text pre-check; the real, authoritative
 * decision is `parseMongooseFile` finding at least one registered model.
 */
export function looksLikeMongooseSource(content: string): boolean {
  return /\bnew\s+(?:\w+\.)?Schema\s*\(/.test(content) && /\bmodel\s*\(/.test(content);
}
