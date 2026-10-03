/**
 * Tests for merging per-file parse results into the unified schema graph
 * (Phase 8): cross-provider isolation, relationship validation, limits and
 * determinism.
 *
 * Run with:  npx tsx src/schema/schemaGraph.test.ts
 */
import { assert, assertEqual, report, test } from "../testHarness.js";
import { MAX_SCHEMA_EDGES, MAX_SCHEMA_FIELDS_PER_MODEL, MAX_SCHEMA_MODELS, buildSchemaGraph } from "./schemaGraph.js";
import type { ParsedSchemaFile } from "./schemaTypes.js";
import type { SchemaModel, SchemaRelationship, SchemaSourceType } from "../types/schema.js";

function model(
  name: string,
  sourceType: SchemaSourceType,
  sourcePath: string,
  fieldCount = 1
): SchemaModel {
  return {
    id: `${sourceType}:${sourcePath}:${name}`,
    name,
    sourceType,
    sourcePath,
    fields: Array.from({ length: fieldCount }, (_, i) => ({
      id: `${name}.f${i}`,
      name: `f${i}`,
      type: "String",
      nullable: true,
      primaryKey: i === 0,
      unique: false,
      array: false,
    })),
    indexes: [],
  };
}

function rel(
  sourceModel: string,
  targetModel: string,
  overrides: Partial<SchemaRelationship> = {}
): SchemaRelationship {
  return {
    id: `${sourceModel}->${targetModel}`,
    sourceModel,
    targetModel,
    cardinality: "1:N",
    inferred: false,
    ...overrides,
  };
}

function file(models: SchemaModel[], relationships: SchemaRelationship[] = []): ParsedSchemaFile {
  return { models, relationships, warnings: [] };
}

// ── basic merging ────────────────────────────────────────────────────────

test("a simple relationship produces one node pair and one edge", () => {
  const result = buildSchemaGraph({
    prisma: [file([model("User", "prisma", "a.prisma"), model("Post", "prisma", "a.prisma")], [rel("User", "Post")])],
    sql: [],
    mongoose: [],
  });
  assertEqual(result.nodes.length, 2, "two nodes");
  assertEqual(result.edges.length, 1, "one edge");
  assertEqual(result.providers, ["prisma"], "provider list");
});

test("every cardinality value passes through unchanged", () => {
  for (const cardinality of ["1:1", "1:N", "N:1", "N:M", "unknown"] as const) {
    const result = buildSchemaGraph({
      prisma: [
        file(
          [model("A", "prisma", "a.prisma"), model("B", "prisma", "a.prisma")],
          [rel("A", "B", { cardinality })]
        ),
      ],
      sql: [],
      mongoose: [],
    });
    assertEqual(result.relationships[0].cardinality, cardinality, `${cardinality} preserved`);
  }
});

// ── cross-provider isolation ─────────────────────────────────────────────

test("same-named models from different providers are never merged", () => {
  const result = buildSchemaGraph({
    prisma: [file([model("User", "prisma", "a.prisma")])],
    sql: [file([model("User", "sql", "b.sql")])],
    mongoose: [],
  });
  assertEqual(result.schemas.length, 2, "two distinct models, not merged into one");
  assertEqual(result.providers, ["prisma", "sql"], "both providers reported");
});

test("a relationship never resolves against a different provider's model", () => {
  // A SQL relationship naming a model that only exists in Prisma must be
  // dropped, not silently linked across providers.
  const result = buildSchemaGraph({
    prisma: [file([model("User", "prisma", "a.prisma")])],
    sql: [file([model("posts", "sql", "b.sql")], [rel("User", "posts")])],
    mongoose: [],
  });
  assertEqual(result.relationships, [], "the dangling cross-provider reference is dropped");
  assert(result.warnings.some((w) => w.includes("sql relationship")), "warning explains why");
});

// ── dangling / missing references ────────────────────────────────────────

test("a relationship referencing a model that does not exist anywhere is dropped", () => {
  const result = buildSchemaGraph({
    prisma: [file([model("User", "prisma", "a.prisma")], [rel("User", "DoesNotExist")])],
    sql: [],
    mongoose: [],
  });
  assertEqual(result.relationships, [], "nothing invented");
});

test("a relationship spanning two different files of the same provider resolves correctly", () => {
  // Supports Prisma schemas split across several *.prisma files, and
  // Mongoose's one-file-per-model convention.
  const result = buildSchemaGraph({
    prisma: [
      file([model("User", "prisma", "user.prisma")], [rel("User", "Post")]),
      file([model("Post", "prisma", "post.prisma")]),
    ],
    sql: [],
    mongoose: [],
  });
  assertEqual(result.relationships.length, 1, "resolved across files");
});

// ── cycles / self-reference ──────────────────────────────────────────────

test("a cycle between two models is represented with both edges", () => {
  const result = buildSchemaGraph({
    prisma: [
      file(
        [model("A", "prisma", "a.prisma"), model("B", "prisma", "a.prisma")],
        [rel("A", "B"), rel("B", "A")]
      ),
    ],
    sql: [],
    mongoose: [],
  });
  assertEqual(result.edges.length, 2, "both directions kept");
});

test("a self-reference is handled safely", () => {
  const result = buildSchemaGraph({
    prisma: [file([model("Employee", "prisma", "a.prisma")], [rel("Employee", "Employee")])],
    sql: [],
    mongoose: [],
  });
  assertEqual(result.edges.length, 1, "one self-edge");
  assertEqual(result.edges[0].source, result.edges[0].target, "source equals target");
});

test("a duplicate relationship is not doubled", () => {
  const result = buildSchemaGraph({
    prisma: [
      file(
        [model("A", "prisma", "a.prisma"), model("B", "prisma", "a.prisma")],
        [rel("A", "B"), rel("A", "B")]
      ),
    ],
    sql: [],
    mongoose: [],
  });
  assertEqual(result.relationships.length, 1, "deduplicated by id");
});

test("disconnected models with no relationships at all are still included", () => {
  const result = buildSchemaGraph({
    prisma: [file([model("Island", "prisma", "a.prisma")])],
    sql: [],
    mongoose: [],
  });
  assertEqual(result.nodes.length, 1, "the model is still a node");
  assertEqual(result.edges, [], "no edges");
});

// ── limits ───────────────────────────────────────────────────────────────

test("max models truncates deterministically and flags the reason", () => {
  const models = Array.from({ length: MAX_SCHEMA_MODELS + 10 }, (_, i) => model(`M${i}`, "prisma", "a.prisma"));
  const result = buildSchemaGraph({ prisma: [file(models)], sql: [], mongoose: [] });
  assertEqual(result.schemas.length, MAX_SCHEMA_MODELS, "capped");
  assertEqual(result.truncated, true, "flagged");
  assertEqual(result.truncationReason, "max_models", "reason given, never silent");
});

test("max fields per model truncates that model's field list", () => {
  const result = buildSchemaGraph({
    prisma: [file([model("Big", "prisma", "a.prisma", MAX_SCHEMA_FIELDS_PER_MODEL + 20)])],
    sql: [],
    mongoose: [],
  });
  assertEqual(result.schemas[0].fields.length, MAX_SCHEMA_FIELDS_PER_MODEL, "capped");
  assertEqual(result.truncated, true, "flagged");
});

test("max edges truncates deterministically and flags the reason", () => {
  // Few enough models to stay well under MAX_SCHEMA_MODELS, but a
  // relationship between every ordered pair comfortably exceeds
  // MAX_SCHEMA_EDGES (25 models -> 25*24 = 600 possible edges).
  const modelCount = 25;
  const models = Array.from({ length: modelCount }, (_, i) => model(`M${i}`, "prisma", "a.prisma"));
  const relationships: ReturnType<typeof rel>[] = [];
  for (let i = 0; i < modelCount; i += 1) {
    for (let j = 0; j < modelCount; j += 1) {
      if (i === j) continue;
      relationships.push(rel(`M${i}`, `M${j}`, { id: `r${i}-${j}` }));
    }
  }
  assert(relationships.length > MAX_SCHEMA_EDGES, "fixture actually exceeds the limit");

  const result = buildSchemaGraph({ prisma: [file(models, relationships)], sql: [], mongoose: [] });
  assertEqual(result.schemas.length, modelCount, "models themselves are not truncated");
  assertEqual(result.edges.length, MAX_SCHEMA_EDGES, "capped");
  assertEqual(result.truncated, true, "flagged");
  assertEqual(result.truncationReason, "max_edges", "specific reason");
});

test("never silently truncates — a normal-sized schema is not flagged", () => {
  const result = buildSchemaGraph({
    prisma: [file([model("A", "prisma", "a.prisma"), model("B", "prisma", "a.prisma")], [rel("A", "B")])],
    sql: [],
    mongoose: [],
  });
  assertEqual(result.truncated, false, "complete");
});

// ── empty / no schema ────────────────────────────────────────────────────

test("no models at all produces the exact required warning", () => {
  const result = buildSchemaGraph({ prisma: [], sql: [], mongoose: [] });
  assertEqual(result.schemas, [], "empty");
  assertEqual(result.providers, [], "no providers");
  assert(
    result.warnings.includes("No supported database schema definitions were detected."),
    "exact spec wording"
  );
});

// ── determinism ──────────────────────────────────────────────────────────

test("model and edge ordering is deterministic regardless of input order", () => {
  const a = model("Zebra", "prisma", "a.prisma");
  const b = model("Alpha", "prisma", "a.prisma");
  const result1 = buildSchemaGraph({ prisma: [file([a, b])], sql: [], mongoose: [] });
  const result2 = buildSchemaGraph({ prisma: [file([b, a])], sql: [], mongoose: [] });
  assertEqual(
    result1.schemas.map((m) => m.name),
    result2.schemas.map((m) => m.name),
    "same order regardless of input order"
  );
  assertEqual(result1.schemas.map((m) => m.name), ["Alpha", "Zebra"], "sorted by name");
});

test("output is deterministic across repeated runs", () => {
  const input = {
    prisma: [
      file(
        [model("A", "prisma", "a.prisma"), model("B", "prisma", "a.prisma")],
        [rel("A", "B")]
      ),
    ],
    sql: [] as ParsedSchemaFile[],
    mongoose: [] as ParsedSchemaFile[],
  };
  const r1 = buildSchemaGraph(input);
  const r2 = buildSchemaGraph(input);
  assertEqual(r1, r2, "identical output");
});

await report("Schema graph merging tests");
