import assert from "node:assert/strict";
import { test } from "node:test";
import { parameters, validateInput } from "./input.ts";

const valid = { repo: "owner/repo", runs: [{ id: 1 }] };

test("strict schema and runtime defaults", () => {
  assert.deepEqual(validateInput(valid), {
    ...valid,
    intervalSeconds: 15,
    timeoutSeconds: 1800,
    failFast: true,
  });
  assert.equal(Reflect.get(parameters, "additionalProperties"), false);
  assert.equal(
    Reflect.get(parameters.properties.runs.items, "additionalProperties"),
    false,
  );
  assert.equal(Reflect.get(parameters.properties.runs, "minItems"), 1);
  assert.equal(Reflect.get(parameters.properties.runs, "maxItems"), 10);
  assert.equal(
    Reflect.get(parameters.properties.intervalSeconds, "minimum"),
    5,
  );
  assert.equal(
    Reflect.get(parameters.properties.timeoutSeconds, "maximum"),
    86400,
  );
  assert.equal(Reflect.get(parameters.properties.failFast, "default"), true);
});

for (const [index, [input, message]] of [
  [null, "arguments must be an object"],
  [{ ...valid, extra: "hidden" }, "unknown argument"],
  [{ ...valid, repo: "https://github.com/o/r" }, "repo must be OWNER/REPO"],
  [{ ...valid, repo: "host/o/r" }, "repo must be OWNER/REPO"],
  [{ ...valid, repo: "--help/r" }, "repo must be OWNER/REPO"],
  [{ ...valid, repo: "o/.." }, "repo must be OWNER/REPO"],
  [{ ...valid, repo: "o/r\n" }, "repo must be OWNER/REPO"],
  [{ ...valid, runs: [] }, "runs must contain 1-10"],
  [
    { ...valid, runs: Array.from({ length: 11 }, (_, i) => ({ id: i + 1 })) },
    "runs must contain 1-10",
  ],
  [
    { ...valid, runs: [{ id: 1 }, { id: 1, label: "different" }] },
    "duplicate run ID 1",
  ],
  [{ ...valid, runs: [{ id: 0 }] }, "positive safe integers"],
  [{ ...valid, runs: [{ id: 1.5 }] }, "positive safe integers"],
  [
    { ...valid, runs: [{ id: Number.MAX_SAFE_INTEGER + 1 }] },
    "positive safe integers",
  ],
  [{ ...valid, runs: [{ id: "1" }] }, "positive safe integers"],
  [
    { ...valid, runs: [{ id: 1, extra: "hidden" }] },
    "only id and optional label",
  ],
  [{ ...valid, runs: [{ id: 1, label: 123 }] }, "labels must be"],
  [{ ...valid, runs: [{ id: 1, label: " " }] }, "labels must be"],
  [{ ...valid, runs: [{ id: 1, label: "a\nb" }] }, "labels must be"],
  [{ ...valid, runs: [{ id: 1, label: "a\u202eb" }] }, "labels must be"],
  [{ ...valid, runs: [{ id: 1, label: "a".repeat(81) }] }, "labels must be"],
  [{ ...valid, intervalSeconds: 4 }, "intervalSeconds must be"],
  [{ ...valid, intervalSeconds: Infinity }, "intervalSeconds must be"],
  [{ ...valid, timeoutSeconds: 0 }, "timeoutSeconds must be"],
  [{ ...valid, timeoutSeconds: 86401 }, "timeoutSeconds must be"],
  [{ ...valid, timeoutSeconds: NaN }, "timeoutSeconds must be"],
  [{ ...valid, failFast: "false" }, "failFast must be a boolean"],
].entries()) {
  test(`rejects invalid input ${index} without echoing arbitrary values`, () => {
    assert.throws(
      () => validateInput(input),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.startsWith("github_ci_wait: "));
        assert.ok(error.message.includes(String(message)));
        return true;
      },
    );
  });
}
