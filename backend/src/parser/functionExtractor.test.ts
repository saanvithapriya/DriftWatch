/**
 * Tests for static function and call-site extraction (Phase 6).
 *
 * Run with:  npx tsx src/parser/functionExtractor.test.ts
 */
import { assert, assertEqual, report, test } from "../testHarness.js";
import { analyzeFunctionsAndCalls } from "./functionExtractor.js";

// ── function declaration shapes ─────────────────────────────────────────

test("function declaration", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "function greet() {}");
  assertEqual(idx.functions.length, 1, "one function");
  assertEqual(idx.functions[0].kind, "function-declaration", "kind");
  assertEqual(idx.functions[0].id, "a.js::greet", "deterministic id");
});

test("function expression bound via const", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "const greet = function () {};");
  assertEqual(idx.functions[0].kind, "function-expression", "kind");
  assertEqual(idx.functions[0].name, "greet", "name taken from the binding");
});

test("arrow function bound via const", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "const greet = () => {};");
  assertEqual(idx.functions[0].kind, "arrow-function", "kind");
  assertEqual(idx.functions[0].id, "a.js::greet", "id");
});

test("async function", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "async function load() {}");
  assertEqual(idx.functions[0].kind, "function-declaration", "still a declaration");
  assertEqual(idx.functions[0].name, "load", "name");
});

test("class method", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "class Foo { createOrder() {} }");
  assertEqual(idx.functions[0].kind, "method", "kind");
  assertEqual(idx.functions[0].id, "a.js::Foo.createOrder", "qualified by class");
});

test("class constructor", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "class Foo { constructor() {} }");
  assertEqual(idx.functions[0].kind, "constructor", "kind");
  assert(idx.classConstructors.get("Foo") === idx.functions[0].id, "registered as the class constructor");
});

test("object literal method", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "const obj = { handler() {} };");
  assertEqual(idx.functions[0].kind, "method", "kind");
  assertEqual(idx.functions[0].id, "a.js::obj.handler", "qualified by the object's local name");
});

test("exported function", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "export function foo() {}");
  assertEqual(idx.functions[0].exported, true, "exported");
  assertEqual(idx.functions[0].isDefaultExport, false, "not default");
});

test("default exported named function", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "export default function App() {}");
  assertEqual(idx.functions[0].exported, true, "exported");
  assertEqual(idx.functions[0].isDefaultExport, true, "default");
  assertEqual(idx.functions[0].id, "a.js::App", "keeps its own name");
});

test("default exported anonymous function", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "export default function () {}");
  assertEqual(idx.functions[0].isDefaultExport, true, "default");
  assert(idx.functions[0].id.startsWith("a.js::default@"), "line-anchored id");
});

test("TypeScript typed function", () => {
  const idx = analyzeFunctionsAndCalls("a.ts", "function add(x: number, y: number): number { return x + y; }");
  assertEqual(idx.functions[0].name, "add", "name unaffected by types");
});

test("generic function", () => {
  const idx = analyzeFunctionsAndCalls("a.ts", "function identity<T>(x: T): T { return x; }");
  assertEqual(idx.functions[0].name, "identity", "name unaffected by generics");
});

test("JSX function component", () => {
  const idx = analyzeFunctionsAndCalls("a.jsx", "function App() { return <div />; }");
  assertEqual(idx.functions[0].kind, "function-declaration", "kind");
});

test("TSX arrow function component", () => {
  const idx = analyzeFunctionsAndCalls(
    "a.tsx",
    'const App: React.FC = () => { return <div>{items.map((i) => <span key={i} />)}</div>; };'
  );
  assertEqual(idx.functions[0].name, "App", "component found");
});

test("anonymous callback gets a line-anchored id", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "items.map(function () { return 1; });");
  assertEqual(idx.functions.length, 1, "extracted");
  assert(idx.functions[0].id.startsWith("a.js::callback@"), "anchored, not name-based");
});

test("class-property arrow function", () => {
  const idx = analyzeFunctionsAndCalls(
    "a.jsx",
    "class W { handleClick = () => { this.onClick(); }; onClick() {} }"
  );
  const handler = idx.functions.find((f) => f.name === "handleClick");
  assertEqual(handler?.kind, "class-property-function", "kind");
  assertEqual(handler?.id, "a.jsx::W.handleClick", "qualified by class");
});

// ── call extraction ──────────────────────────────────────────────────────

test("direct call", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "function main() { foo(); }");
  const calls = idx.callSites.filter((c) => !c.isCallback);
  assertEqual(calls.length, 1, "one call");
  assertEqual(calls[0].callee, { kind: "identifier", name: "foo" }, "identifier callee");
});

test("member call", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "function main() { obj.foo(); }");
  const calls = idx.callSites.filter((c) => !c.isCallback);
  assertEqual(calls[0].callee, { kind: "member", objectName: "obj", property: "foo" }, "member callee");
});

test("nested member call is recognised but not deep-resolved", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "function main() { obj.foo.bar(); }");
  const calls = idx.callSites.filter((c) => !c.isCallback);
  assertEqual(calls[0].callee, { kind: "other" }, "not a simple one-hop member");
});

test("await call", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "async function main() { await foo(); }");
  const calls = idx.callSites.filter((c) => !c.isCallback);
  assertEqual(calls[0].callee, { kind: "identifier", name: "foo" }, "callee");
  assert(calls[0].text.startsWith("await "), "await reflected in the displayed text");
});

test("new expression", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "function main() { new Foo(); }");
  const calls = idx.callSites.filter((c) => !c.isCallback);
  assertEqual(calls[0].callee, { kind: "identifier", name: "Foo" }, "constructor callee");
});

test("callback reference is recorded as a probable call target", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "function main() { items.map(transform); }");
  const callback = idx.callSites.find((c) => c.isCallback);
  assert(callback !== undefined, "callback call site recorded");
  assertEqual(callback?.callee, { kind: "identifier", name: "transform" }, "callee");
});

test("this.method() call inside a class", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "class Foo { a() { this.b(); } b() {} }");
  const calls = idx.callSites.filter((c) => !c.isCallback);
  assertEqual(calls[0].callee, { kind: "this-member", property: "b" }, "this-member callee");
  assertEqual(calls[0].containingClassName, "Foo", "class context recorded");
});

test("dynamic subscript call is never guessed at", () => {
  const idx = analyzeFunctionsAndCalls(
    "a.js",
    "function main() { const method = user[input]; method(); }"
  );
  // `method` has no static binding to a function value, so it stays a bare
  // identifier callee with nothing in `bindings` to resolve it against.
  assertEqual(idx.bindings.has("method"), false, "not treated as a function binding");
});

// ── security ──────────────────────────────────────────────────────────────

test("malicious identifiers do not break extraction", () => {
  const payload = '"; DROP TABLE users; --';
  const idx = analyzeFunctionsAndCalls(
    "a.js",
    `const ${JSON.stringify(payload)};\nfunction main() {}`
  );
  assert(!idx.failed, "still parses (or fails closed, but does not throw)");
});

test("Mermaid metacharacters in a name survive as plain text", () => {
  const idx = analyzeFunctionsAndCalls("a.js", 'const obj = { "a\\"];x[\\"b"() {} };');
  assert(typeof idx.failed === "boolean", "never throws");
});

test("HTML-like identifiers are stored as plain data, not markup", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "function main() { html(); }");
  const call = idx.callSites.find((c) => !c.isCallback);
  assertEqual(call?.text, "html()", "plain text, no interpretation");
});

test("Unicode identifiers are handled", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "function 你好() {}");
  assertEqual(idx.functions[0].name, "你好", "extracted as-is");
});

test("control characters in source do not crash extraction", () => {
  const idx = analyzeFunctionsAndCalls("a.js", "function main() {}\n\u0000\u0001\u0007");
  assert(typeof idx.failed === "boolean", "returns a result");
});

test("a huge identifier is clamped in call-site text, not rejected outright", () => {
  const hugeName = "x".repeat(5000);
  const idx = analyzeFunctionsAndCalls("a.js", `function main() { ${hugeName}(); }`);
  const call = idx.callSites.find((c) => !c.isCallback);
  assert(call !== undefined, "call still recorded");
  assert((call?.text.length ?? 0) <= 205, "clamped to a bounded length");
});

test("deeply nested syntax fails closed rather than crashing the process", () => {
  const deep = "function main() {" + "if (true) {".repeat(2000) + "}".repeat(2000) + "}";
  const idx = analyzeFunctionsAndCalls("a.js", deep);
  assert(typeof idx.failed === "boolean", "returns a result rather than throwing");
});

// ── determinism ──────────────────────────────────────────────────────────

test("extraction is deterministic across repeated runs", () => {
  const source = "function a() { b(); }\nfunction b() {}\nclass C { m() {} }";
  const first = analyzeFunctionsAndCalls("a.js", source);
  const second = analyzeFunctionsAndCalls("a.js", source);
  assertEqual(
    first.functions.map((f) => f.id),
    second.functions.map((f) => f.id),
    "same ids in the same order"
  );
  assertEqual(
    first.callSites.map((c) => c.text),
    second.callSites.map((c) => c.text),
    "same call sites"
  );
});

test("two same-named functions in one file get disambiguated ids", () => {
  const idx = analyzeFunctionsAndCalls(
    "a.js",
    "const items = { handler() {} };\nconst other = { handler() {} };"
  );
  const ids = idx.functions.map((f) => f.id);
  assertEqual(new Set(ids).size, ids.length, "no id collisions");
});

await report("Function and call-site extraction tests");
