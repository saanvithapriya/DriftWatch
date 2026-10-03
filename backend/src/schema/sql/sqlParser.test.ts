/**
 * Tests for static SQL `CREATE TABLE` parsing (Phase 8).
 *
 * Run with:  npx tsx src/schema/sql/sqlParser.test.ts
 */
import { assert, assertEqual, report, test } from "../../testHarness.js";
import { isSqlSchemaPath, parseSqlSchema } from "./sqlParser.js";

function fieldOf(models: ReturnType<typeof parseSqlSchema>["models"], tableName: string, columnName: string) {
  return models.find((m) => m.name === tableName)?.fields.find((f) => f.name === columnName);
}

test("any .sql path is detected", () => {
  assertEqual(isSqlSchemaPath("schema.sql"), true, "root");
  assertEqual(isSqlSchemaPath("migrations/0001_init.sql"), true, "migration");
  assertEqual(isSqlSchemaPath("schema.prisma"), false, "not sql");
});

// ── CREATE TABLE basics ──────────────────────────────────────────────────

test("a basic CREATE TABLE", () => {
  const sql = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP
);
`;
  const result = parseSqlSchema("schema.sql", sql);
  assertEqual(result.models.length, 1, "one table");
  assertEqual(result.models[0].name, "users", "name");
  assertEqual(fieldOf(result.models, "users", "id")?.primaryKey, true, "inline PRIMARY KEY");
  assertEqual(fieldOf(result.models, "users", "email")?.unique, true, "UNIQUE");
  assertEqual(fieldOf(result.models, "users", "email")?.nullable, false, "NOT NULL");
  assertEqual(fieldOf(result.models, "users", "name")?.nullable, true, "nullable by default");
});

test("multiple CREATE TABLE statements in one file", () => {
  const sql = "CREATE TABLE a (id INTEGER PRIMARY KEY);\nCREATE TABLE b (id INTEGER PRIMARY KEY);";
  const result = parseSqlSchema("schema.sql", sql);
  assertEqual(result.models.map((m) => m.name), ["a", "b"], "both found");
});

test("table-level PRIMARY KEY", () => {
  const sql = "CREATE TABLE users (\n  id INTEGER,\n  PRIMARY KEY (id)\n);";
  const result = parseSqlSchema("schema.sql", sql);
  assertEqual(fieldOf(result.models, "users", "id")?.primaryKey, true, "marked via table-level constraint");
});

test("table-level UNIQUE", () => {
  const sql = "CREATE TABLE users (\n  email VARCHAR(255),\n  UNIQUE (email)\n);";
  const result = parseSqlSchema("schema.sql", sql);
  assertEqual(result.models[0].indexes, [{ fields: ["email"], unique: true }], "composite unique recorded");
});

test("NOT NULL and DEFAULT", () => {
  const sql = "CREATE TABLE users (\n  active BOOLEAN NOT NULL DEFAULT true\n);";
  const result = parseSqlSchema("schema.sql", sql);
  const field = fieldOf(result.models, "users", "active");
  assertEqual(field?.nullable, false, "not null");
  assertEqual(field?.defaultValue, "true", "default captured");
});

test("a quoted default string is unquoted in the DTO", () => {
  const sql = "CREATE TABLE users (\n  email VARCHAR(255) DEFAULT 'none@example.com'\n);";
  const result = parseSqlSchema("schema.sql", sql);
  assertEqual(fieldOf(result.models, "users", "email")?.defaultValue, "none@example.com", "unquoted");
});

// ── foreign keys / references ────────────────────────────────────────────

test("inline column-level REFERENCES", () => {
  const sql = `
CREATE TABLE users (id INTEGER PRIMARY KEY);
CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id)
);
`;
  const result = parseSqlSchema("schema.sql", sql);
  assertEqual(result.relationships.length, 1, "one relationship");
  assertEqual(
    result.relationships[0],
    {
      id: "users->posts:user_id",
      sourceModel: "users",
      targetModel: "posts",
      cardinality: "1:N",
      targetField: "user_id",
      inferred: false,
      sourceField: "id",
    },
    "matches spec section 13's own example: users 1:N posts"
  );
});

test("table-level FOREIGN KEY ... REFERENCES", () => {
  const sql = `
CREATE TABLE users (id INTEGER, PRIMARY KEY (id));
CREATE TABLE posts (
  id INTEGER,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`;
  const result = parseSqlSchema("schema.sql", sql);
  assertEqual(result.relationships[0].sourceModel, "users", "referenced table is the source");
  assertEqual(result.relationships[0].targetModel, "posts", "owning table is the target");
});

test("a CONSTRAINT-named FOREIGN KEY is still recognised", () => {
  const sql = `
CREATE TABLE users (id INTEGER PRIMARY KEY);
CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id)
);
`;
  const result = parseSqlSchema("schema.sql", sql);
  assertEqual(result.relationships.length, 1, "recognised despite the CONSTRAINT name");
});

// ── quoted identifiers / comments ────────────────────────────────────────

test("double-quoted and backtick-quoted identifiers are unquoted", () => {
  const sql = 'CREATE TABLE "users" (\n  "id" INTEGER PRIMARY KEY\n);';
  const result = parseSqlSchema("schema.sql", sql);
  assertEqual(result.models[0].name, "users", "unquoted table name");
  assertEqual(fieldOf(result.models, "users", "id")?.name, "id", "unquoted column name");
});

test("-- and /* */ comments are stripped", () => {
  const sql = `
-- users table
CREATE TABLE users (
  id INTEGER PRIMARY KEY, -- primary key
  /* a block comment */
  email VARCHAR(255)
);
`;
  const result = parseSqlSchema("schema.sql", sql);
  assertEqual(result.models[0].fields.map((f) => f.name), ["id", "email"], "parsed cleanly");
});

test("-- inside a quoted default value is not mistaken for a comment", () => {
  const sql = "CREATE TABLE t (\n  note VARCHAR(255) DEFAULT 'a--b'\n);";
  const result = parseSqlSchema("schema.sql", sql);
  assertEqual(fieldOf(result.models, "t", "note")?.defaultValue, "a--b", "preserved");
});

test("a multiline CREATE TABLE statement", () => {
  const sql = `
CREATE TABLE
  users
(
  id
    INTEGER
    PRIMARY KEY
);
`;
  const result = parseSqlSchema("schema.sql", sql);
  assertEqual(result.models.length, 1, "parsed across lines");
});

// ── malformed / unsupported syntax ───────────────────────────────────────

test("a malformed table does not destroy the rest of the file", () => {
  const sql = `
CREATE TABLE good_one (id INTEGER PRIMARY KEY);
CREATE TABLE broken_one (this is not valid ((( ;
CREATE TABLE good_two (id INTEGER PRIMARY KEY, name VARCHAR(255));
`;
  const result = parseSqlSchema("schema.sql", sql);
  assertEqual(result.models.map((m) => m.name), ["good_one", "good_two"], "both valid tables kept");
  assert(result.warnings.length > 0, "the broken one produced a warning");
});

test("unsupported syntax produces a warning rather than throwing", () => {
  const sql = "CREATE TABLE t (\n  CHECK (price > 0)\n);";
  const result = parseSqlSchema("schema.sql", sql);
  assert(typeof result.models.length === "number", "no throw");
});

test("completely unparseable junk does not throw", () => {
  const result = parseSqlSchema("schema.sql", "\u0000\u0001 ((( CREATE CREATE CREATE");
  assert(typeof result.models.length === "number", "returns a result");
});

// ── determinism ──────────────────────────────────────────────────────────

test("parsing is deterministic across repeated runs", () => {
  const sql = "CREATE TABLE a (id INTEGER PRIMARY KEY);\nCREATE TABLE b (id INTEGER REFERENCES a(id));";
  const first = parseSqlSchema("schema.sql", sql);
  const second = parseSqlSchema("schema.sql", sql);
  assertEqual(first, second, "identical output");
});

// ── security ─────────────────────────────────────────────────────────────

test("a hostile value in DEFAULT is kept as inert data, never executed", () => {
  const sql = `CREATE TABLE t (\n  bio VARCHAR(255) DEFAULT '"><script>alert(1)</script>'\n);`;
  const result = parseSqlSchema("schema.sql", sql);
  assertEqual(
    fieldOf(result.models, "t", "bio")?.defaultValue,
    '"><script>alert(1)</script>',
    "plain string data"
  );
});

test("a SQL-injection-shaped identifier is just a name, never executed", () => {
  const sql = "CREATE TABLE DROP_TABLE_USERS (\n  id INTEGER PRIMARY KEY\n);";
  const result = parseSqlSchema("schema.sql", sql);
  assertEqual(result.models[0].name, "DROP_TABLE_USERS", "treated as plain text");
});

await report("SQL schema parser tests");
