import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { ExploreToolParameters } from "./explore-parameters.ts";

test("accepts the upstream Explore parameter contract", () => {
  assert.equal(Value.Check(ExploreToolParameters, { query: "GraphManager" }), true);
  assert.equal(Value.Check(ExploreToolParameters, {
    query: "SessionStoreManager afterCommit",
    maxFiles: 5,
    projectPath: "/home/gc/development/wi",
  }), true);
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
