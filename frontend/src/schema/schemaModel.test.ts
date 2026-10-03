/**
 * Tests for the pure Schema view helpers (Phase 8): local search, provider/
 * relationship filtering, the connected-component ER layout, and the small
 * display-logic helpers (field flags, edge labels, handle sides) that drive
 * the custom React Flow node/edge rendering.
 *
 * Run with:  npx tsx src/schema/schemaModel.test.ts
 */
import type { SchemaGraphEdge, SchemaGraphNode, SchemaModel } from "../types/schema";
import { assert, assertEqual, report, test } from "../utils/testHarness";
import {
  availableProviders,
  edgeHandleSides,
  edgeLabel,
  estimateNodeHeight,
  fieldFlags,
  filterSchemaGraph,
  layoutSchemaGraph,
  modelNamesByProvider,
  providerLabel,
  relationCountsById,
  SCHEMA_NODE_WIDTH,
} from "./schemaModel";

function model(name: string, overrides: Partial<SchemaModel> = {}): SchemaModel {
  return {
    id: `prisma:a.prisma:${name}`,
    name,
    sourceType: "prisma",
    sourcePath: "a.prisma",
    fields: [{ id: `${name}.id`, name: "id", type: "Int", nullable: false, primaryKey: true, unique: false, array: false }],
    indexes: [],
    ...overrides,
  };
}

function node(m: SchemaModel): SchemaGraphNode {
  return { id: m.id, model: m };
}

function edge(source: SchemaGraphNode, target: SchemaGraphNode, cardinality: SchemaGraphEdge["relationship"]["cardinality"] = "1:N", inferred = false): SchemaGraphEdge {
  return {
    id: `${source.id}->${target.id}`,
    source: source.id,
    target: target.id,
    relationship: {
      id: `${source.id}->${target.id}`,
      sourceModel: source.model.name,
      targetModel: target.model.name,
      cardinality,
      inferred,
    },
  };
}

// ── search ───────────────────────────────────────────────────────────────

test("search matches a model's own name", () => {
  const user = node(model("User"));
  const result = filterSchemaGraph([user], [], { search: "user", provider: "all", relationship: "all" });
  assertEqual(result.nodes.length, 1, "matched");
});

test("search matches a qualified field name, per spec section 19's own example", () => {
  const post = node(
    model("Post", {
      fields: [{ id: "Post.userId", name: "userId", type: "Int", nullable: false, primaryKey: false, unique: false, array: false }],
    })
  );
  const result = filterSchemaGraph([post], [], { search: "user", provider: "all", relationship: "all" });
  assertEqual(result.nodes.length, 1, "Post.userId matches 'user' even though the model is named Post");
});

test("search is case-insensitive", () => {
  const user = node(model("User"));
  assertEqual(
    filterSchemaGraph([user], [], { search: "USER", provider: "all", relationship: "all" }).nodes.length,
    1,
    "matched regardless of case"
  );
});

test("an empty search matches everything", () => {
  const nodes = [node(model("A")), node(model("B"))];
  assertEqual(
    filterSchemaGraph(nodes, [], { search: "", provider: "all", relationship: "all" }).nodes.length,
    2,
    "no filtering"
  );
});

test("a non-matching search excludes the model entirely", () => {
  const user = node(model("User"));
  assertEqual(
    filterSchemaGraph([user], [], { search: "zzz", provider: "all", relationship: "all" }).nodes,
    [],
    "excluded"
  );
});

// ── provider filter ──────────────────────────────────────────────────────

test("the provider filter keeps only matching models", () => {
  const prismaNode = node(model("A", { sourceType: "prisma" }));
  const sqlNode = node(model("B", { sourceType: "sql", id: "sql:a.sql:B" }));
  const result = filterSchemaGraph([prismaNode, sqlNode], [], {
    search: "",
    provider: "sql",
    relationship: "all",
  });
  assertEqual(result.nodes.map((n) => n.model.name), ["B"], "only the sql model");
});

// ── relationship filter + dangling-edge safety ──────────────────────────

test("the relationship filter keeps only edges with a matching cardinality", () => {
  const a = node(model("A"));
  const b = node(model("B", { id: "prisma:a.prisma:B" }));
  const oneToOne = edge(a, b, "1:1");
  const oneToMany = edge(a, b, "1:N");
  const result = filterSchemaGraph([a, b], [oneToOne, oneToMany], {
    search: "",
    provider: "all",
    relationship: "1:1",
  });
  assertEqual(result.edges.length, 1, "only the matching edge");
  assertEqual(result.edges[0].relationship.cardinality, "1:1", "correct one kept");
});

test("an edge never survives filtering when one endpoint is filtered out — no dangling edges", () => {
  const a = node(model("A"));
  const b = node(model("B", { id: "prisma:a.prisma:B" }));
  const result = filterSchemaGraph([a, b], [edge(a, b)], { search: "A", provider: "all", relationship: "all" });
  assertEqual(result.nodes.map((n) => n.model.name), ["A"], "only A matches the search");
  assertEqual(result.edges, [], "the edge to the now-excluded B is also excluded");
});

// ── availableProviders ───────────────────────────────────────────────────

test("availableProviders lists only providers actually present, sorted", () => {
  const nodes = [
    node(model("A", { sourceType: "sql", id: "sql:a.sql:A" })),
    node(model("B", { sourceType: "prisma" })),
  ];
  assertEqual(availableProviders(nodes), ["prisma", "sql"], "sorted, deduplicated");
});

// ── providerLabel ────────────────────────────────────────────────────────

test("providerLabel gives a human-readable name for every source type", () => {
  assertEqual(providerLabel("prisma"), "Prisma", "prisma");
  assertEqual(providerLabel("sql"), "SQL", "sql");
  assertEqual(providerLabel("mongoose"), "Mongoose", "mongoose");
});

// ── estimateNodeHeight ───────────────────────────────────────────────────

test("node height grows with field count, up to the shown cap", () => {
  const short = estimateNodeHeight(2);
  const long = estimateNodeHeight(8);
  assert(long > short, "more fields means a taller card");
});

test("node height does not keep growing past the max-shown cap, only the '+N more' row is added", () => {
  const atCap = estimateNodeHeight(8);
  const overCap = estimateNodeHeight(50);
  assert(overCap > atCap, "the '+N more' footer still adds some height");
  assert(overCap - atCap < estimateNodeHeight(16) - atCap + 1, "but nowhere near one row per extra field");
});

// ── fieldFlags ───────────────────────────────────────────────────────────

test("a primary key field is flagged PK", () => {
  const field = { id: "f", name: "id", type: "Int", nullable: false, primaryKey: true, unique: false, array: false };
  assert(fieldFlags(field, new Set()).includes("PK"), "PK present");
});

test("a field with an explicit reference is flagged FK", () => {
  const field = {
    id: "f",
    name: "authorId",
    type: "Int",
    nullable: false,
    primaryKey: false,
    unique: false,
    array: false,
    references: { model: "User", field: "id" },
  };
  assertEqual(fieldFlags(field, new Set()), ["FK"], "FK only");
});

test("a unique field is flagged UQ", () => {
  const field = { id: "f", name: "email", type: "String", nullable: false, primaryKey: false, unique: true, array: false };
  assert(fieldFlags(field, new Set()).includes("UQ"), "UQ present");
});

test("a required non-key field is flagged REQ", () => {
  const field = {
    id: "f",
    name: "title",
    type: "String",
    nullable: false,
    primaryKey: false,
    unique: false,
    array: false,
    required: true,
  };
  assertEqual(fieldFlags(field, new Set()), ["REQ"], "REQ only");
});

test("a navigation field whose type names another model is flagged REL, alongside REQ", () => {
  const field = {
    id: "f",
    name: "posts",
    type: "Post[]",
    nullable: false,
    primaryKey: false,
    unique: false,
    array: true,
    required: true,
  };
  assertEqual(fieldFlags(field, new Set(["Post"])), ["REQ", "REL"], "both apply, FK does not");
});

test("a scalar field whose type happens to share a name is not flagged REL unless it is a real model", () => {
  const field = { id: "f", name: "status", type: "Status", nullable: false, primaryKey: false, unique: false, array: false };
  assertEqual(fieldFlags(field, new Set(["User", "Post"])), [], "Status is not a known model here");
});

test("an explicit foreign key column does not also get REL — FK and REL are mutually exclusive", () => {
  const field = {
    id: "f",
    name: "author",
    type: "User",
    nullable: false,
    primaryKey: false,
    unique: false,
    array: false,
    references: { model: "User" },
  };
  assertEqual(fieldFlags(field, new Set(["User"])), ["FK"], "FK wins, not FK+REL");
});

// ── modelNamesByProvider ─────────────────────────────────────────────────

test("modelNamesByProvider never mixes names across providers", () => {
  const nodes = [
    node(model("User", { sourceType: "prisma" })),
    node(model("User", { sourceType: "sql", id: "sql:x.sql:User", sourcePath: "x.sql" })),
  ];
  const byProvider = modelNamesByProvider(nodes);
  assertEqual([...(byProvider.get("prisma") ?? [])], ["User"], "prisma bucket");
  assertEqual([...(byProvider.get("sql") ?? [])], ["User"], "sql bucket, independently");
});

// ── relationCountsById ───────────────────────────────────────────────────

test("relationCountsById counts both endpoints of every edge", () => {
  const a = node(model("A"));
  const b = node(model("B", { id: "prisma:a.prisma:B" }));
  const counts = relationCountsById([edge(a, b)]);
  assertEqual(counts.get(a.id), 1, "A has one relation");
  assertEqual(counts.get(b.id), 1, "B has one relation");
});

test("relationCountsById counts a self-relation once, not twice", () => {
  const a = node(model("A"));
  const counts = relationCountsById([edge(a, a)]);
  assertEqual(counts.get(a.id), 1, "one relation, even though both ends are the same node");
});

// ── edgeLabel ────────────────────────────────────────────────────────────

test("edgeLabel shows the cardinality verbatim when known", () => {
  const a = node(model("A"));
  const b = node(model("B", { id: "prisma:a.prisma:B" }));
  assertEqual(edgeLabel(edge(a, b, "N:M").relationship), "N:M", "shown as-is");
});

test("edgeLabel never fabricates a cardinality — unknown renders as '?'", () => {
  const a = node(model("A"));
  const b = node(model("B", { id: "prisma:a.prisma:B" }));
  assertEqual(edgeLabel(edge(a, b, "unknown").relationship), "?", "a plain question mark");
});

// ── edgeHandleSides ──────────────────────────────────────────────────────

test("a node to the right connects via right/left handles", () => {
  const sides = edgeHandleSides({ x: 0, y: 0 }, { x: 400, y: 0 }, false);
  assertEqual(sides, { sourceSide: "right", targetSide: "left" }, "exits right, enters left");
});

test("a node to the left connects via left/right handles", () => {
  const sides = edgeHandleSides({ x: 400, y: 0 }, { x: 0, y: 0 }, false);
  assertEqual(sides, { sourceSide: "left", targetSide: "right" }, "exits left, enters right");
});

test("a node below connects via bottom/top handles", () => {
  const sides = edgeHandleSides({ x: 0, y: 0 }, { x: 0, y: 400 }, false);
  assertEqual(sides, { sourceSide: "bottom", targetSide: "top" }, "exits bottom, enters top");
});

test("a self-relation always loops from top to right of the same node", () => {
  assertEqual(edgeHandleSides({ x: 0, y: 0 }, { x: 0, y: 0 }, true), { sourceSide: "top", targetSide: "right" }, "fixed loop sides");
});

// ── layout ───────────────────────────────────────────────────────────────

test("every node gets a position", () => {
  const a = node(model("A"));
  const b = node(model("B", { id: "prisma:a.prisma:B" }));
  const positioned = layoutSchemaGraph([a, b], [edge(a, b)]);
  assertEqual(positioned.length, 2, "both positioned");
  assert(positioned.every((p) => typeof p.x === "number" && typeof p.y === "number"), "numeric coordinates");
});

test("layout is deterministic across repeated calls", () => {
  const a = node(model("A"));
  const b = node(model("B", { id: "prisma:a.prisma:B" }));
  const c = node(model("C", { id: "prisma:a.prisma:C" }));
  const edges = [edge(a, b), edge(b, c)];
  const first = layoutSchemaGraph([a, b, c], edges);
  const second = layoutSchemaGraph([a, b, c], edges);
  assertEqual(
    first.map((p) => `${p.node.id}:${p.x},${p.y}`),
    second.map((p) => `${p.node.id}:${p.x},${p.y}`),
    "identical layout"
  );
});

test("input order does not change the layout", () => {
  const a = node(model("A"));
  const b = node(model("B", { id: "prisma:a.prisma:B" }));
  const c = node(model("C", { id: "prisma:a.prisma:C" }));
  const edges = [edge(a, b), edge(b, c)];
  const forward = layoutSchemaGraph([a, b, c], edges);
  const reversed = layoutSchemaGraph([c, b, a], edges);
  const asMap = (list: typeof forward) => new Map(list.map((p) => [p.node.id, `${p.x},${p.y}`]));
  assertEqual([...asMap(forward)], [...asMap(reversed)], "same positions regardless of input order");
});

test("a malicious model name does not break layout — it is plain data throughout", () => {
  const malicious = node(model('"; sequenceDiagram\nactor Evil'));
  const positioned = layoutSchemaGraph([malicious], []);
  assertEqual(positioned[0].node.model.name, '"; sequenceDiagram\nactor Evil', "kept verbatim as data");
});

test("two disconnected models are laid out as separate components, not stacked on top of each other", () => {
  const a = node(model("A"));
  const b = node(model("B", { id: "prisma:a.prisma:B" }));
  const positioned = layoutSchemaGraph([a, b], []);
  const posA = positioned.find((p) => p.node.id === a.id);
  const posB = positioned.find((p) => p.node.id === b.id);
  assert(posA !== undefined && posB !== undefined, "both placed");
  assert(posA!.x !== posB!.x || posA!.y !== posB!.y, "distinct positions");
});

test("a self-reference is handled safely and still produces a position", () => {
  const a = node(model("A"));
  const positioned = layoutSchemaGraph([a], [edge(a, a)]);
  assertEqual(positioned.length, 1, "the node is still placed exactly once");
});

test("a cycle is handled safely and terminates", () => {
  const a = node(model("A"));
  const b = node(model("B", { id: "prisma:a.prisma:B" }));
  const c = node(model("C", { id: "prisma:a.prisma:C" }));
  const edges = [edge(a, b), edge(b, c), edge(c, a)];
  const positioned = layoutSchemaGraph([a, b, c], edges);
  assertEqual(positioned.length, 3, "every node in the cycle is placed exactly once");
});

test("a hub connected to many models stays in the first column, which every spoke sits to the right of", () => {
  const hub = node(model("Hub"));
  const spokes = ["S1", "S2", "S3", "S4"].map((name) => node(model(name, { id: `prisma:a.prisma:${name}` })));
  const edges = spokes.map((s) => edge(hub, s));
  const positioned = layoutSchemaGraph([hub, ...spokes], edges);
  const hubX = positioned.find((p) => p.node.id === hub.id)!.x;
  for (const spoke of spokes) {
    const spokeX = positioned.find((p) => p.node.id === spoke.id)!.x;
    assert(spokeX > hubX, `${spoke.model.name} sits to the right of the hub it connects to`);
  }
});

test("nodes in the same layer do not overlap vertically when field counts differ a lot", () => {
  const hub = node(model("Hub"));
  const small = node(
    model("Small", {
      id: "prisma:a.prisma:Small",
      fields: [{ id: "Small.id", name: "id", type: "Int", nullable: false, primaryKey: true, unique: false, array: false }],
    })
  );
  const wide = node(
    model("Wide", {
      id: "prisma:a.prisma:Wide",
      fields: Array.from({ length: 20 }, (_, i) => ({
        id: `Wide.f${i}`,
        name: `f${i}`,
        type: "String",
        nullable: false,
        primaryKey: false,
        unique: false,
        array: false,
      })),
    })
  );
  const positioned = layoutSchemaGraph([hub, small, wide], [edge(hub, small), edge(hub, wide)]);
  const smallPos = positioned.find((p) => p.node.id === small.id)!;
  const widePos = positioned.find((p) => p.node.id === wide.id)!;
  const [first, second, firstHeight] =
    smallPos.y <= widePos.y
      ? [smallPos, widePos, estimateNodeHeight(small.model.fields.length)]
      : [widePos, smallPos, estimateNodeHeight(wide.model.fields.length)];
  assert(
    second.y >= first.y + firstHeight,
    "the second card only starts after the first card's real (field-count-aware) height, not a fixed row height"
  );
});

test("a node's width budget (SCHEMA_NODE_WIDTH) is a sane positive number", () => {
  assert(SCHEMA_NODE_WIDTH >= 220 && SCHEMA_NODE_WIDTH <= 300, "within the spec's recommended 220-280px range, with room to spare");
});

await report("Schema view model tests");
