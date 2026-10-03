/**
 * Database schema DTOs, mirroring the backend contract (Phase 8).
 *
 * Declared separately from the backend's copy on purpose: the frontend
 * consumes the API shape, not backend implementation types. Model/field/
 * table names are repository-controlled strings, rendered as plain React
 * text everywhere.
 */

export type SchemaSourceType = "prisma" | "sql" | "mongoose";

export interface SchemaFieldReference {
  model: string;
  field?: string;
}

export interface SchemaField {
  id: string;
  name: string;
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
  inferred: boolean;
}

export interface SchemaGraphNode {
  id: string;
  model: SchemaModel;
}

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
