/**
 * Tests for static Prisma schema parsing (Phase 8).
 *
 * Run with:  npx tsx src/schema/prisma/prismaParser.test.ts
 */
import { assert, assertEqual, report, test } from "../../testHarness.js";
import { isPrismaSchemaPath, parsePrismaSchema } from "./prismaParser.js";

function fieldOf(models: ReturnType<typeof parsePrismaSchema>["models"], modelName: string, fieldName: string) {
  return models.find((m) => m.name === modelName)?.fields.find((f) => f.name === fieldName);
}

// ── path detection ───────────────────────────────────────────────────────

test("schema.prisma and nested *.prisma paths are detected", () => {
  assertEqual(isPrismaSchemaPath("schema.prisma"), true, "root");
  assertEqual(isPrismaSchemaPath("prisma/schema.prisma"), true, "conventional location");
  assertEqual(isPrismaSchemaPath("prisma/models/user.prisma"), true, "nested");
  assertEqual(isPrismaSchemaPath("schema.sql"), false, "not prisma");
});

// ── basic model ───────────────────────────────────────────────────────────

test("a basic model with scalar fields", () => {
  const result = parsePrismaSchema("schema.prisma", "model User {\n  id Int\n  name String\n}");
  assertEqual(result.models.length, 1, "one model");
  assertEqual(result.models[0].name, "User", "name");
  assertEqual(result.models[0].fields.map((f) => f.name), ["id", "name"], "fields in order");
});

test("multiple models in one file", () => {
  const result = parsePrismaSchema(
    "schema.prisma",
    "model A {\n  id Int @id\n}\nmodel B {\n  id Int @id\n}"
  );
  assertEqual(result.models.map((m) => m.name), ["A", "B"], "both found");
});

test("an optional field is nullable", () => {
  const result = parsePrismaSchema("schema.prisma", "model User {\n  name String?\n}");
  const field = fieldOf(result.models, "User", "name");
  assertEqual(field?.nullable, true, "nullable");
  assertEqual(field?.required, false, "not required");
});

test("an array field is marked array, not nullable by that alone", () => {
  const result = parsePrismaSchema("schema.prisma", "model User {\n  tags String[]\n}");
  const field = fieldOf(result.models, "User", "tags");
  assertEqual(field?.array, true, "array");
  assertEqual(field?.type, "String[]", "type text");
});

// ── field attributes ─────────────────────────────────────────────────────

test("@id marks a field as the primary key", () => {
  const result = parsePrismaSchema("schema.prisma", "model User {\n  id Int @id\n}");
  assertEqual(fieldOf(result.models, "User", "id")?.primaryKey, true, "primary key");
});

test("@unique marks a field as unique", () => {
  const result = parsePrismaSchema("schema.prisma", "model User {\n  email String @unique\n}");
  assertEqual(fieldOf(result.models, "User", "email")?.unique, true, "unique");
});

test("@default captures the default expression", () => {
  const result = parsePrismaSchema(
    "schema.prisma",
    'model User {\n  id Int @id @default(autoincrement())\n  active Boolean @default(true)\n}'
  );
  assertEqual(fieldOf(result.models, "User", "id")?.defaultValue, "autoincrement()", "function default");
  assertEqual(fieldOf(result.models, "User", "active")?.defaultValue, "true", "literal default");
});

test("@@id marks a composite primary key", () => {
  const result = parsePrismaSchema(
    "schema.prisma",
    "model Membership {\n  userId Int\n  teamId Int\n  @@id([userId, teamId])\n}"
  );
  const model = result.models[0];
  assert(model.fields.every((f) => f.primaryKey), "both fields marked primary key");
  assertEqual(model.indexes, [{ fields: ["teamId", "userId"], unique: true }], "composite index recorded");
});

test("@@unique records a composite unique index without marking fields unique", () => {
  const result = parsePrismaSchema(
    "schema.prisma",
    "model Membership {\n  userId Int\n  teamId Int\n  @@unique([userId, teamId])\n}"
  );
  assertEqual(result.models[0].indexes, [{ fields: ["teamId", "userId"], unique: true }], "composite unique");
  assert(
    result.models[0].fields.every((f) => !f.unique),
    "individual fields not marked unique by a composite constraint"
  );
});

test("@@index records a non-unique index", () => {
  const result = parsePrismaSchema("schema.prisma", "model User {\n  email String\n  @@index([email])\n}");
  assertEqual(result.models[0].indexes, [{ fields: ["email"], unique: false }], "index recorded");
});

// ── relationships ────────────────────────────────────────────────────────

test("@relation with fields/references produces an explicit 1:N relationship", () => {
  const schema = `
model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  name  String?
  posts Post[]
}

model Post {
  id       Int  @id
  title    String
  authorId Int
  author   User @relation(fields: [authorId], references: [id])
}
`;
  const result = parsePrismaSchema("schema.prisma", schema);
  assertEqual(result.relationships.length, 1, "exactly one relationship");
  assertEqual(
    result.relationships[0],
    {
      id: "User->Post:authorId",
      sourceModel: "User",
      targetModel: "Post",
      cardinality: "1:N",
      sourceField: "id",
      targetField: "authorId",
      inferred: false,
    },
    "matches the spec's own example exactly"
  );
});

test("a unique foreign key field produces a 1:1 relationship", () => {
  const schema = `
model User { id Int @id }
model Profile {
  id     Int  @id
  userId Int  @unique
  user   User @relation(fields: [userId], references: [id])
}
`;
  const result = parsePrismaSchema("schema.prisma", schema);
  assertEqual(result.relationships[0].cardinality, "1:1", "one-to-one");
});

test("a relation name is carried through", () => {
  const schema = `
model User { id Int @id }
model Post {
  id       Int  @id
  authorId Int
  author   User @relation(name: "PostAuthor", fields: [authorId], references: [id])
}
`;
  assertEqual(parsePrismaSchema("schema.prisma", schema).relationships[0].relationName, "PostAuthor", "name kept");
});

test("positional relation name syntax is also recognised", () => {
  const schema = `
model User { id Int @id }
model Post {
  id       Int  @id
  authorId Int
  author   User @relation("PostAuthor", fields: [authorId], references: [id])
}
`;
  assertEqual(parsePrismaSchema("schema.prisma", schema).relationships[0].relationName, "PostAuthor", "name kept");
});

test("implicit many-to-many: two plain array fields pointing at each other", () => {
  const schema = `
model Post {
  id         Int        @id
  categories Category[]
}
model Category {
  id    Int    @id
  posts Post[]
}
`;
  const result = parsePrismaSchema("schema.prisma", schema);
  assertEqual(result.relationships.length, 1, "one N:M relationship, not two");
  assertEqual(result.relationships[0].cardinality, "N:M", "many-to-many");
  assertEqual(result.relationships[0].sourceModel, "Category", "alphabetically first");
  assertEqual(result.relationships[0].targetModel, "Post", "alphabetically second");
  assertEqual(result.relationships[0].inferred, false, "a deterministic ORM relation, not a guess");
});

test("self-relation does not also produce a spurious many-to-many edge", () => {
  const schema = `
model Employee {
  id           Int        @id
  managerId    Int?
  manager      Employee?  @relation("ManagerSubordinates", fields: [managerId], references: [id])
  subordinates Employee[] @relation("ManagerSubordinates")
}
`;
  const result = parsePrismaSchema("schema.prisma", schema);
  assertEqual(result.relationships.length, 1, "exactly one relationship");
  assertEqual(result.relationships[0].cardinality, "1:N", "the explicit one");
});

test("cycles between two models are handled safely", () => {
  const schema = `
model A {
  id    Int  @id
  bId   Int
  b     B    @relation(fields: [bId], references: [id])
}
model B {
  id    Int  @id
  aId   Int
  a     A    @relation(fields: [aId], references: [id])
}
`;
  const result = parsePrismaSchema("schema.prisma", schema);
  assertEqual(result.relationships.length, 2, "both directions captured, no infinite loop");
});

test("an array relation field with no matching counterpart invents nothing", () => {
  const schema = "model Post { id Int @id }\nmodel Category { id Int @id posts Post[] }";
  const result = parsePrismaSchema("schema.prisma", schema);
  assertEqual(result.relationships, [], "Post has no reciprocal array field, so nothing is invented");
});

// ── comments and formatting ──────────────────────────────────────────────

test("line and block comments are stripped", () => {
  const schema = `
// a comment
model User {
  /* block comment */
  id Int @id // trailing comment
}
`;
  const result = parsePrismaSchema("schema.prisma", schema);
  assertEqual(result.models[0].fields.map((f) => f.name), ["id"], "parsed cleanly");
});

test("// inside a quoted default value is not mistaken for a comment", () => {
  const schema = 'model Setting {\n  url String @default("http://example.com//path")\n}';
  const result = parsePrismaSchema("schema.prisma", schema);
  assertEqual(fieldOf(result.models, "Setting", "url")?.defaultValue, "http://example.com//path", "preserved");
});

test("a multiline @relation is joined correctly", () => {
  const schema = `
model User { id Int @id }
model Post {
  id       Int  @id
  authorId Int
  author   User @relation(
    fields: [authorId],
    references: [id]
  )
}
`;
  const result = parsePrismaSchema("schema.prisma", schema);
  assertEqual(result.relationships.length, 1, "parsed across lines");
  assertEqual(result.relationships[0].targetField, "authorId", "fields extracted correctly");
});

// ── malformed input ──────────────────────────────────────────────────────

test("a malformed model does not destroy the rest of the file", () => {
  const schema = `
model Good {
  id Int @id
}

model AlsoGood {
  id Int @id
  name String
}
`;
  const result = parsePrismaSchema("schema.prisma", schema);
  assertEqual(result.models.map((m) => m.name), ["Good", "AlsoGood"], "both parsed");
});

test("completely unparseable junk does not throw", () => {
  const result = parsePrismaSchema("schema.prisma", "\u0000\u0001 ((( model model model {{{");
  assert(typeof result.models.length === "number", "returns a result rather than throwing");
});

// ── determinism ──────────────────────────────────────────────────────────

test("parsing is deterministic across repeated runs", () => {
  const schema = "model A { id Int @id posts Post[] }\nmodel Post { id Int @id categories A[] }";
  const first = parsePrismaSchema("schema.prisma", schema);
  const second = parsePrismaSchema("schema.prisma", schema);
  assertEqual(first, second, "identical output");
});

await report("Prisma schema parser tests");
