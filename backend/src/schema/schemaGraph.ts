import type {
  SchemaGraphEdge,
  SchemaGraphNode,
  SchemaModel,
  SchemaRelationship,
  SchemaSourceType,
  SchemaStats,
  SchemaTruncationReason,
} from "../types/schema.js";
import type { ParsedSchemaFile } from "./schemaTypes.js";

/**
 * Merges every provider's per-file parse results into the unified schema
 * graph (spec sections 14/15/17/18/27).
 *
 * Relationships are validated — and, if they reference a model that does
 * not exist, dropped — strictly within their own provider's model set.
 * `SchemaRelationship` never carries a provider tag in the public DTO, so
 * this module tracks provenance itself, in provider-scoped buckets, all the
 * way through to the final filtering step; nothing here ever resolves a
 * Prisma relationship against a SQL or Mongoose model, or vice versa, even
 * when two models share a name.
 */

export const MAX_SCHEMA_MODELS = 200;
export const MAX_SCHEMA_FIELDS_PER_MODEL = 100;
export const MAX_SCHEMA_EDGES = 400;

export interface SchemaGraphInput {
  prisma: ParsedSchemaFile[];
  sql: ParsedSchemaFile[];
  mongoose: ParsedSchemaFile[];
}

export interface SchemaGraphResult {
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

const PROVIDERS: readonly SchemaSourceType[] = ["prisma", "sql", "mongoose"];

function sortModels(models: SchemaModel[]): SchemaModel[] {
  return [...models].sort(
    (a, b) =>
      a.sourceType.localeCompare(b.sourceType) ||
      a.name.localeCompare(b.name) ||
      a.sourcePath.localeCompare(b.sourcePath)
  );
}

function sortRelationships(relationships: SchemaRelationship[]): SchemaRelationship[] {
  return [...relationships].sort((a, b) => a.id.localeCompare(b.id));
}

export function buildSchemaGraph(input: SchemaGraphInput): SchemaGraphResult {
  const warnings: string[] = [];
  const modelsByProvider = new Map<SchemaSourceType, SchemaModel[]>();
  const relationshipsByProvider = new Map<SchemaSourceType, SchemaRelationship[]>();

  for (const provider of PROVIDERS) {
    const files = input[provider];
    const models: SchemaModel[] = [];
    const relationships: SchemaRelationship[] = [];

    for (const file of files) {
      models.push(...file.models);
      relationships.push(...file.relationships);
      warnings.push(...file.warnings);
    }

    modelsByProvider.set(provider, models);
    relationshipsByProvider.set(provider, relationships);
  }

  // Cap and sort fields/indexes within each model, deterministically.
  let fieldsTruncated = false;
  for (const models of modelsByProvider.values()) {
    for (const model of models) {
      model.fields.sort((a, b) => a.name.localeCompare(b.name));
      if (model.fields.length > MAX_SCHEMA_FIELDS_PER_MODEL) {
        fieldsTruncated = true;
        model.fields = model.fields.slice(0, MAX_SCHEMA_FIELDS_PER_MODEL);
      }
      model.indexes.sort((a, b) => a.fields.join(",").localeCompare(b.fields.join(",")));
    }
  }

  // Validate relationships against their own provider's full model set —
  // never across providers — and deduplicate.
  const validatedByProvider = new Map<SchemaSourceType, SchemaRelationship[]>();
  for (const provider of PROVIDERS) {
    const modelNames = new Set(modelsByProvider.get(provider)?.map((m) => m.name) ?? []);
    const relationships = relationshipsByProvider.get(provider) ?? [];
    const seen = new Set<string>();
    const kept: SchemaRelationship[] = [];
    let dangling = 0;

    for (const rel of relationships) {
      if (seen.has(rel.id)) continue;
      if (!modelNames.has(rel.sourceModel) || !modelNames.has(rel.targetModel)) {
        dangling += 1;
        continue;
      }
      seen.add(rel.id);
      kept.push(rel);
    }

    if (dangling > 0) {
      warnings.push(
        `${dangling} ${provider} relationship(s) referenced a model that was not found and were skipped.`
      );
    }
    validatedByProvider.set(provider, kept);
  }

  // Apply the overall model cap across the merged, sorted model list.
  let allModels = sortModels([...modelsByProvider.values()].flat());
  let modelsTruncated = false;
  if (allModels.length > MAX_SCHEMA_MODELS) {
    modelsTruncated = true;
    allModels = allModels.slice(0, MAX_SCHEMA_MODELS);
  }

  // A per-provider name -> model id map, built from the *kept* models only,
  // so a relationship referencing a model cut off by the cap above is
  // dropped too, rather than left dangling in the final graph.
  const keptIdByProviderAndName = new Map<SchemaSourceType, Map<string, string>>();
  for (const model of allModels) {
    let map = keptIdByProviderAndName.get(model.sourceType);
    if (map === undefined) {
      map = new Map();
      keptIdByProviderAndName.set(model.sourceType, map);
    }
    // First match wins, deterministically (models are already name-sorted):
    // two same-named models from the same provider are a rare, honest
    // ambiguity this does not try to disambiguate further.
    if (!map.has(model.name)) map.set(model.name, model.id);
  }

  const finalRelationships: SchemaRelationship[] = [];
  for (const provider of PROVIDERS) {
    const nameToId = keptIdByProviderAndName.get(provider) ?? new Map<string, string>();
    for (const rel of validatedByProvider.get(provider) ?? []) {
      if (nameToId.has(rel.sourceModel) && nameToId.has(rel.targetModel)) {
        finalRelationships.push(rel);
      }
    }
  }

  let sortedRelationships = sortRelationships(finalRelationships);
  let edgesTruncated = false;
  if (sortedRelationships.length > MAX_SCHEMA_EDGES) {
    edgesTruncated = true;
    sortedRelationships = sortedRelationships.slice(0, MAX_SCHEMA_EDGES);
  }

  const nodes: SchemaGraphNode[] = allModels.map((model) => ({ id: model.id, model }));
  const edges: SchemaGraphEdge[] = [];
  for (const relationship of sortedRelationships) {
    // `finalRelationships` was already filtered, per provider, to only
    // contain endpoints present in `keptIdByProviderAndName` — find which
    // provider's bucket resolves both ends (at most 3 providers to check).
    for (const provider of PROVIDERS) {
      const map = keptIdByProviderAndName.get(provider);
      const sourceId = map?.get(relationship.sourceModel);
      const targetId = map?.get(relationship.targetModel);
      if (sourceId !== undefined && targetId !== undefined) {
        edges.push({ id: relationship.id, source: sourceId, target: targetId, relationship });
        break;
      }
    }
  }

  const providers = PROVIDERS.filter((p) => (modelsByProvider.get(p)?.length ?? 0) > 0);

  const byProvider: Record<string, number> = {};
  for (const provider of providers) byProvider[provider] = modelsByProvider.get(provider)?.length ?? 0;

  const stats: SchemaStats = {
    models: allModels.length,
    fields: allModels.reduce((sum, m) => sum + m.fields.length, 0),
    relationships: sortedRelationships.length,
    primaryKeys: allModels.reduce((sum, m) => sum + m.fields.filter((f) => f.primaryKey).length, 0),
    foreignKeys: sortedRelationships.length,
    indexes: allModels.reduce((sum, m) => sum + m.indexes.length, 0),
    byProvider,
  };

  if (allModels.length === 0) {
    warnings.push("No supported database schema definitions were detected.");
  }

  const truncated = fieldsTruncated || modelsTruncated || edgesTruncated;
  const truncationReason: SchemaTruncationReason | undefined = modelsTruncated
    ? "max_models"
    : edgesTruncated
      ? "max_edges"
      : fieldsTruncated
        ? "max_fields"
        : undefined;
  if (truncated) warnings.push("Schema exceeded configured visualization limits.");

  return {
    providers,
    schemas: allModels,
    relationships: sortedRelationships,
    nodes,
    edges,
    stats,
    warnings,
    truncated,
    ...(truncationReason !== undefined ? { truncationReason } : {}),
  };
}
