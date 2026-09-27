import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { ExploreToolParameters } from "./explore-parameters.ts";

test("accepts identifier bags and natural-language questions", () => {
  assert.equal(Value.Check(ExploreToolParameters, { query: "GraphManager" }), true);
  assert.equal(Value.Check(ExploreToolParameters, {
    query: "SessionStoreManager afterCommit",
    maxFiles: 5,
    projectPath: "/home/gc/development/wi",
  }), true);
  assert.equal(Value.Check(ExploreToolParameters, {
    query: "How does session state reach the commit handler?",
  }), true);
});

test("advertises identifier-first query guidance", () => {
  const description = ExploreToolParameters.properties.query.description;
  assert.match(description, /^Symbol names, file paths, or short code terms/);
  assert.match(description, /natural-language question also works/);
});

test("enforces maxFiles bounds", () => {
  assert.equal(Value.Check(ExploreToolParameters, { query: "GraphManager", maxFiles: 0 }), false);
  assert.equal(Value.Check(ExploreToolParameters, { query: "GraphManager", maxFiles: 21 }), false);
  assert.equal(Value.Check(ExploreToolParameters, { query: "GraphManager", maxFiles: 1.5 }), false);
});

test("rejects removed reduced-context parameters", () => {
  assert.equal(Value.Check(ExploreToolParameters, { query: "GraphManager", includeCode: true }), false);
  assert.equal(Value.Check(ExploreToolParameters, { query: "GraphManager", maxNodes: 50 }), false);
});
