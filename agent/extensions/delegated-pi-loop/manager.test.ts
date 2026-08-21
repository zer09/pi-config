import assert from "node:assert/strict";
import test from "node:test";
import { combinedSignal, DelegateManager } from "./manager.ts";

test("oracle runs exclusively against every other active delegate", () => {
  // An exclusive oracle blocks any new delegate while it is active.
  const oracleFirst = new DelegateManager();
  oracleFirst.begin("1", "oracle");
  assert.throws(() => oracleFirst.begin("2", "review-a"), /oracle delegate must run sequentially/);
  assert.throws(() => oracleFirst.begin("2", "implementation"), /oracle delegate must run sequentially/);
  oracleFirst.finish("1");
  oracleFirst.begin("2", "review-a");

  // An active exclusive delegate blocks a new oracle, and any active delegate
  // blocks a new oracle because the oracle itself is exclusive.
  const blocked = new DelegateManager();
  blocked.begin("1", "implementation");
  assert.throws(() => blocked.begin("2", "oracle"), /oracle delegate must run sequentially/);
  blocked.finish("1");
  blocked.begin("1", "review-b");
  assert.throws(() => blocked.begin("2", "oracle"), /oracle delegate must run sequentially/);

  // Read-only non-exclusive roles keep running concurrently without an oracle.
  const concurrent = new DelegateManager();
  concurrent.begin("1", "solution-a");
  concurrent.begin("2", "solution-d");
  concurrent.begin("3", "review-c");
});

test("combinedSignal forwards aborts from either source", () => {
  const first = new AbortController();
  const second = new AbortController();
  const signal = combinedSignal(first.signal, second.signal);
  assert.equal(signal.aborted, false);
  second.abort();
  assert.equal(signal.aborted, true);
  assert.equal(combinedSignal(undefined, second.signal).aborted, true);
});
