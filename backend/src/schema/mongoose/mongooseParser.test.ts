/**
 * Tests for static Mongoose schema parsing (Phase 8), built on Phase 4's
 * Tree-sitter infrastructure.
 *
 * Run with:  npx tsx src/schema/mongoose/mongooseParser.test.ts
 */
import { assert, assertEqual, report, test } from "../../testHarness.js";
import { looksLikeMongooseSource, parseMongooseFile } from "./mongooseParser.js";

function fieldOf(models: ReturnType<typeof parseMongooseFile>["models"], modelName: string, fieldName: string) {
  return models.find((m) => m.name === modelName)?.fields.find((f) => f.name === fieldName);
}

// ── detection ────────────────────────────────────────────────────────────

test("a file with Schema and model constructs looks like Mongoose source", () => {
  assertEqual(
    looksLikeMongooseSource('new mongoose.Schema({ name: String });\nmongoose.model("User", schema);'),
    true,
    "detected"
  );
});

test("an ordinary JS/TS file does not look like Mongoose source", () => {
  assertEqual(looksLikeMongooseSource("export function add(a, b) { return a + b; }"), false, "not every file");
});

// ── mongoose.Schema() ────────────────────────────────────────────────────

test("new mongoose.Schema({...}) with mongoose.model(...)", () => {
  const src = `
const mongoose = require("mongoose");
const userSchema = new mongoose.Schema({ name: String });
mongoose.model("User", userSchema);
`;
  const result = parseMongooseFile("models/User.js", src);
  assertEqual(result.models.length, 1, "one model");
  assertEqual(result.models[0].name, "User", "name from model()");
  assertEqual(fieldOf(result.models, "User", "name")?.type, "String", "shorthand scalar type");
});

test("destructured { Schema, model } import", () => {
  const src = `
const { Schema, model } = require("mongoose");
const PostSchema = new Schema({ title: String });
model("Post", PostSchema);
`;
  const result = parseMongooseFile("models/Post.js", src);
  assertEqual(result.models[0].name, "Post", "found via bare identifiers");
});

test("an inline schema not assigned to a variable", () => {
  const src = `
const mongoose = require("mongoose");
module.exports = mongoose.model("Comment", new mongoose.Schema({ text: String }));
`;
  const result = parseMongooseFile("models/Comment.js", src);
  assertEqual(result.models[0].name, "Comment", "resolved without a local variable");
  assertEqual(fieldOf(result.models, "Comment", "text")?.type, "String", "fields extracted");
});

test("export default mongoose.model(...)", () => {
  const src = `
import mongoose from "mongoose";
const schema = new mongoose.Schema({ name: String });
export default mongoose.model("Widget", schema);
`;
  const result = parseMongooseFile("models/Widget.ts", src);
  assertEqual(result.models[0].name, "Widget", "found through export default");
});

// ── field options ────────────────────────────────────────────────────────

test("detailed field options: required, unique, default", () => {
  const src = `
const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  age: { type: Number, default: 18 }
});
mongoose.model("User", schema);
`;
  const result = parseMongooseFile("a.js", src);
  const email = fieldOf(result.models, "User", "email");
  assertEqual(email?.required, true, "required");
  assertEqual(email?.unique, true, "unique");
  assertEqual(email?.nullable, false, "not nullable when required");
  assertEqual(fieldOf(result.models, "User", "age")?.defaultValue, "18", "default captured");
});

test("enum values are folded into the type", () => {
  const src = `
const mongoose = require("mongoose");
const schema = new mongoose.Schema({ role: { type: String, enum: ["admin", "user"] } });
mongoose.model("User", schema);
`;
  const result = parseMongooseFile("a.js", src);
  assertEqual(fieldOf(result.models, "User", "role")?.type, "enum(admin|user)", "enum values present");
});

test("array shorthand: [String]", () => {
  const src = `
const mongoose = require("mongoose");
const schema = new mongoose.Schema({ tags: [String] });
mongoose.model("User", schema);
`;
  const result = parseMongooseFile("a.js", src);
  const field = fieldOf(result.models, "User", "tags");
  assertEqual(field?.array, true, "array");
  assertEqual(field?.type, "String[]", "scalar type kept");
});

test("ObjectId via a member-expression chain", () => {
  const src = `
const mongoose = require("mongoose");
const schema = new mongoose.Schema({ owner: mongoose.Schema.Types.ObjectId });
mongoose.model("Thing", schema);
`;
  const result = parseMongooseFile("a.js", src);
  assertEqual(fieldOf(result.models, "Thing", "owner")?.type, "ObjectId", "last segment of the chain");
});

test("nested subdocument fields are flattened with a dotted name", () => {
  const src = `
const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  profile: { bio: String, avatar: String }
});
mongoose.model("User", schema);
`;
  const result = parseMongooseFile("a.js", src);
  assertEqual(
    result.models[0].fields.map((f) => f.name).sort(),
    ["profile.avatar", "profile.bio"],
    "flattened, not a separate model"
  );
});

test("a dynamic expression as a field type is ignored, not guessed at", () => {
  const src = `
const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  name: String,
  computed: someFunction()
});
mongoose.model("Weird", schema);
`;
  const result = parseMongooseFile("a.js", src);
  assertEqual(result.models[0].fields.map((f) => f.name), ["name"], "the call expression is skipped");
});

test("a malformed/unparseable file does not throw", () => {
  const result = parseMongooseFile("a.js", "\u0000\u0001 ((( {{{ function (");
  assert(typeof result.models.length === "number", "returns a result");
});

// ── relationships (ref:) ─────────────────────────────────────────────────

test("a singular ObjectId ref produces an explicit 1:N relationship", () => {
  const src = `
const { Schema, model } = require("mongoose");
const PostSchema = new Schema({
  title: String,
  author: { type: Schema.Types.ObjectId, ref: "User" }
});
model("Post", PostSchema);
`;
  const result = parseMongooseFile("a.js", src);
  assertEqual(
    result.relationships[0],
    {
      id: "User->Post:author",
      sourceModel: "User",
      targetModel: "Post",
      cardinality: "1:N",
      targetField: "author",
      inferred: false,
    },
    "ref: is explicit metadata, so inferred is false"
  );
});

test("an array of ObjectId refs is 'unknown' cardinality, never guessed", () => {
  const src = `
const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  posts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Post" }]
});
mongoose.model("User", schema);
`;
  const result = parseMongooseFile("a.js", src);
  assertEqual(result.relationships[0].cardinality, "unknown", "never guessed at N:M vs N:1");
  assertEqual(result.relationships[0].inferred, false, "the ref itself is still explicit");
});

// ── determinism ──────────────────────────────────────────────────────────

test("parsing is deterministic across repeated runs", () => {
  const src = `
const mongoose = require("mongoose");
const schema = new mongoose.Schema({ name: String, tags: [String] });
mongoose.model("User", schema);
`;
  const first = parseMongooseFile("a.js", src);
  const second = parseMongooseFile("a.js", src);
  assertEqual(first, second, "identical output");
});

// ── security ─────────────────────────────────────────────────────────────

test("a hostile default value is kept as inert text, never executed", () => {
  const src = `
const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  bio: { type: String, default: "\\"><script>alert(1)</script>" }
});
mongoose.model("User", schema);
`;
  const result = parseMongooseFile("a.js", src);
  assert(
    (fieldOf(result.models, "User", "bio")?.defaultValue ?? "").includes("<script>"),
    "stored verbatim as a string, not interpreted"
  );
});

test("a hostile model name is treated as plain data", () => {
  const src = `
const mongoose = require("mongoose");
const schema = new mongoose.Schema({ name: String });
mongoose.model("'; DROP TABLE users; --", schema);
`;
  const result = parseMongooseFile("a.js", src);
  assertEqual(result.models[0].name, "'; DROP TABLE users; --", "never executed, just a string");
});

await report("Mongoose schema parser tests");
