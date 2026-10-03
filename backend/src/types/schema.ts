/**
 * Database schema DTOs — the contract between backend and frontend (Phase 8).
 *
 * Plain data only: no Tree-sitter nodes, no Octokit types, no credentials.
 * Everything here is statically read from repository source files. Nothing
 * here connects to a database, executes SQL, or requires credentials.
 */

export type SchemaSourceType = "prisma" | "sql" | "mongoose";

export interface SchemaFieldReference {
  model: string;
  field?: string;
}

export interface SchemaField {
  id: string;
  name: string;
  /** Written as the source expresses it (`Int`, `VARCHAR(255)`, `String`, …). */
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  array: boolean;
  required?: boolean;
  defaultValue?: string;
  references?: SchemaFieldReference;
}

export interface SchemaIndex {
  name?: string;
  fields: string[];
  unique: boolean;
}

export interface SchemaModel {
  id: string;
  name: string;
  sourceType: SchemaSourceType;
  sourcePath: string;
  fields: SchemaField[];
  indexes: SchemaIndex[];
}

export type SchemaCardinality = "1:1" | "1:N" | "N:1" | "N:M" | "unknown";

export interface SchemaRelationship {
  id: string;
  sourceModel: string;
  targetModel: string;
  cardinality: SchemaCardinality;
  sourceField?: string;
  targetField?: string;
  relationName?: string;
  /** False only when the source explicitly declares the relationship
   *  (`@relation`, `REFERENCES`, `ref:`) — never set for a name-based guess. */
  inferred: boolean;
}

/** One graph node per schema model/table. */
export interface SchemaGraphNode {
  id: string;
  model: SchemaModel;
}

/** One graph edge per relationship, `source` depends on/references `target`. */
export interface SchemaGraphEdge {
  id: string;
  source: string;
  target: string;
  relationship: SchemaRelationship;
}

export type SchemaTruncationReason = "max_models" | "max_fields" | "max_edges";

export interface SchemaStats {
  models: number;
  fields: number;
  relationships: number;
  primaryKeys: number;
  foreignKeys: number;
  indexes: number;
  /** Models/tables found per provider, e.g. `{ prisma: 4, sql: 2 }`. */
  byProvider: Record<string, number>;
}

export interface SchemaRepositoryInfo {
  owner: string;
  name: string;
  defaultBranch: string;
}

export interface SchemaAnalysis {
  repository: SchemaRepositoryInfo;
  providers: SchemaSourceType[];
  schemas: SchemaModel[];
  relationships: SchemaRelationship[];
  nodes: SchemaGraphNode[];
  edges: SchemaGraphEdge[];
  stats: SchemaStats;
  warnings: string[];
  truncated: boolean;
  truncationReason?: SchemaTruncationReason;
}

export interface SchemaRequestBody {
  url?: unknown;
}

export interface SchemaAnalysisResponse {
  success: true;
  data: SchemaAnalysis;
}
