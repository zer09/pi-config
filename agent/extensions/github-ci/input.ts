import { Type, type Static } from "typebox";

const REPO_PATTERN =
  "^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?/(?!\\.{1,2}$)[A-Za-z0-9_.-]{1,100}(?![\\s\\S])";
const LABEL_PATTERN =
  "^[^\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\ufeff]+(?![\\s\\S])";

export const parameters = Type.Object(
  {
    repo: Type.String({
      pattern: REPO_PATTERN,
      description: "OWNER/REPO, without a hostname or URL.",
    }),
    runs: Type.Array(
      Type.Object(
        {
          id: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
          label: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 80,
              pattern: LABEL_PATTERN,
            }),
          ),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 10, uniqueItems: true },
    ),
    intervalSeconds: Type.Optional(Type.Number({ minimum: 5, default: 15 })),
    timeoutSeconds: Type.Optional(
      Type.Number({ exclusiveMinimum: 0, maximum: 86400, default: 1800 }),
    ),
    failFast: Type.Optional(Type.Boolean({ default: true })),
  },
  { additionalProperties: false },
);

export type WaitInput = Static<typeof parameters>;
export type ValidatedInput = Required<WaitInput>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new Error(`github_ci_wait: ${message}`);
}

export function validateInput(value: unknown): ValidatedInput {
  if (!isRecord(value)) invalid("arguments must be an object.");
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "repo",
          "runs",
          "intervalSeconds",
          "timeoutSeconds",
          "failFast",
        ].includes(key),
    )
  ) {
    invalid("unknown argument.");
  }
  if (
    typeof value.repo !== "string" ||
    !new RegExp(REPO_PATTERN).test(value.repo)
  ) {
    invalid("repo must be OWNER/REPO.");
  }
  if (
    !Array.isArray(value.runs) ||
    value.runs.length < 1 ||
    value.runs.length > 10
  ) {
    invalid("runs must contain 1-10 run IDs.");
  }
  const ids = new Set<number>();
  const runs = value.runs.map((run) => {
    if (
      !isRecord(run) ||
      Object.keys(run).some((key) => key !== "id" && key !== "label")
    ) {
      invalid("each run must contain only id and optional label.");
    }
    if (
      typeof run.id !== "number" ||
      !Number.isSafeInteger(run.id) ||
      run.id <= 0
    ) {
      invalid("run IDs must be positive safe integers.");
    }
    if (ids.has(run.id)) invalid(`duplicate run ID ${run.id}.`);
    ids.add(run.id);
    if (
      run.label !== undefined &&
      (typeof run.label !== "string" ||
        run.label.trim().length === 0 ||
        [...run.label].length > 80 ||
        !new RegExp(LABEL_PATTERN).test(run.label))
    ) {
      invalid("labels must be 1-80 printable characters on one line.");
    }
    return {
      id: run.id,
      ...(run.label !== undefined ? { label: run.label as string } : {}),
    };
  });
  const intervalSeconds =
    value.intervalSeconds === undefined ? 15 : value.intervalSeconds;
  if (
    typeof intervalSeconds !== "number" ||
    !Number.isFinite(intervalSeconds) ||
    intervalSeconds < 5
  ) {
    invalid("intervalSeconds must be a finite number >= 5.");
  }
  const timeoutSeconds =
    value.timeoutSeconds === undefined ? 1800 : value.timeoutSeconds;
  if (
    typeof timeoutSeconds !== "number" ||
    !Number.isFinite(timeoutSeconds) ||
    timeoutSeconds <= 0 ||
    timeoutSeconds > 86400
  ) {
    invalid("timeoutSeconds must be > 0 and <= 86400.");
  }
  const failFast = value.failFast === undefined ? true : value.failFast;
  if (typeof failFast !== "boolean") invalid("failFast must be a boolean.");
  return { repo: value.repo, runs, intervalSeconds, timeoutSeconds, failFast };
}
