import type { SchemaModel, SchemaRelationship } from "../types/schema.js";

/**
 * Internal (parser-layer) schema types, shared by every provider.
 *
 * A provider parser never sees a request, a session or a GitHub credential —
 * it is handed one file's path and text and returns structured facts about
 * it. The unified `SchemaModel`/`SchemaRelationship` DTOs are used directly
 * here (unlike Phase 6's extractor, no extra bookkeeping fields are needed
 * beyond what the API already exposes).
 */
export interface ParsedSchemaFile {
  models: SchemaModel[];
  /** Relationships found within this one file, already resolved to model
   *  names — cross-file name resolution happens one layer up, in
   *  `schemaService.ts`, and never crosses a provider boundary. */
  relationships: SchemaRelationship[];
  /** Human-readable, non-fatal problems — a malformed block, an
   *  unsupported construct — that still allow the rest of the file to be
   *  used. */
  warnings: string[];
}

export const EMPTY_PARSE_RESULT: ParsedSchemaFile = {
  models: [],
  relationships: [],
  warnings: [],
};
