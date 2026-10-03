/**
 * Tests for the pure History view helpers (Phase 7): formatting and the
 * impact-graph layout adapter.
 *
 * Run with:  npx tsx src/history/historyModel.test.ts
 */
import type { ImpactEdge, ImpactNode } from "../types/history";
import { assert, assertEqual, report, test } from "../utils/testHarness";
import {
  changedFileStatusLabel,
  commitTitle,
  formatCommitDate,
  impactRelationshipLabel,
  layoutImpactGraph,
} from "./historyModel";

// ── formatCommitDate ─────────────────────────────────────────────────────

test("a valid ISO date is formatted, not left raw", () => {
  const formatted = formatCommitDate("2024-01-15T10:30:00Z");
  assert(formatted !== "2024-01-15T10:30:00Z", "reformatted");
  assert(formatted.includes("2024"), "year present");
});

test("an unparseable date falls back to the raw string rather than 'Invalid Date'", () => {
  assertEqual(formatCommitDate("not a date"), "not a date", "raw fallback");
});

// ── commitTitle ──────────────────────────────────────────────────────────

test("only the first line of a multi-line commit message is used", () => {
  assertEqual(commitTitle("fix: bug\n\nLonger explanation here."), "fix: bug", "first line only");
});

test("a very long single-line message is clamped", () => {
  const long = "x".repeat(300);
  const title = commitTitle(long);
  assert(title.length <= 161, "clamped");
  assert(title.endsWith("…"), "ellipsis marker");
});

test("a short message passes through unchanged", () => {
  assertEqual(commitTitle("short"), "short", "unchanged");
});

// ── changedFileStatusLabel ───────────────────────────────────────────────

test("every known status has a label", () => {
  for (const status of ["added", "modified", "removed", "renamed", "copied", "changed", "unchanged"] as const) {
    assertEqual(changedFileStatusLabel(status), status, "identity for these labels");
  }
});

// ── impactRelationshipLabel ──────────────────────────────────────────────

test("every relationship has a distinct, human label", () => {
  assertEqual(impactRelationshipLabel("changed"), "Changed", "changed");
  assertEqual(impactRelationshipLabel("direct"), "Directly affected", "direct");
  assertEqual(impactRelationshipLabel("transitive"), "Transitively affected", "transitive");
  assertEqual(impactRelationshipLabel("unresolved"), "Unresolved", "unresolved");
});

// ── layoutImpactGraph ────────────────────────────────────────────────────

function node(id: string, relationship: ImpactNode["relationship"] = "changed", depth = 0): ImpactNode {
  return { id, path: id, relationship, depth };
}

test("every node gets a position", () => {
  const nodes = [node("a"), node("b", "direct", 1)];
  const edges: ImpactEdge[] = [{ source: "b", target: "a" }];
  const positioned = layoutImpactGraph(nodes, edges);
  assertEqual(positioned.length, 2, "all nodes positioned");
  assert(positioned.every((p) => typeof p.x === "number" && typeof p.y === "number"), "numeric coordinates");
});

test("positions are deterministic across repeated calls", () => {
  const nodes = [node("a"), node("b", "direct", 1), node("c", "transitive", 2)];
  const edges: ImpactEdge[] = [
    { source: "b", target: "a" },
    { source: "c", target: "b" },
  ];
  const first = layoutImpactGraph(nodes, edges);
  const second = layoutImpactGraph(nodes, edges);
  assertEqual(
    first.map((p) => `${p.node.id}:${p.x},${p.y}`),
    second.map((p) => `${p.node.id}:${p.x},${p.y}`),
    "identical layout"
  );
});

test("an isolated node (no edges) is still laid out", () => {
  const positioned = layoutImpactGraph([node("solo")], []);
  assertEqual(positioned.length, 1, "laid out despite no edges");
});

test("a malicious path does not break layout — it is plain data throughout", () => {
  const malicious = node('"; sequenceDiagram\nactor Evil');
  const positioned = layoutImpactGraph([malicious], []);
  assertEqual(positioned[0].node.path, '"; sequenceDiagram\nactor Evil', "kept verbatim as data");
});

await report("History view model tests");
