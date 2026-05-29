import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import {
	DEFAULT_MAX_RESULT_BYTES,
	DEFAULT_THINKING,
	DEFAULT_TIMEOUT_MS,
	MAX_MAX_RESULT_BYTES,
	MAX_TIMEOUT_MS,
	MIN_MAX_RESULT_BYTES,
	MIN_TIMEOUT_MS,
} from "./constants.ts";
import { THINKING_LEVELS } from "./types.ts";

const BaseParamsProperties = {
	agent: Type.String({ description: "Name of a user-level agent in ~/.pi/agent/agents/*.md" }),
	task: Type.String({ description: "Self-contained task to delegate to the child agent" }),
	model: Type.Optional(Type.String({ description: "Optional Pi model override, passed as --model" })),
	thinking: Type.Optional(
		StringEnum(THINKING_LEVELS, {
			description: "Optional thinking level override, passed as --thinking",
			default: DEFAULT_THINKING,
		}),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the child Pi process" })),
	timeoutMs: Type.Optional(
		Type.Number({
			description: `Child timeout in milliseconds. Default ${DEFAULT_TIMEOUT_MS}. Clamped to ${MIN_TIMEOUT_MS}..${MAX_TIMEOUT_MS}.`,
			minimum: MIN_TIMEOUT_MS,
			maximum: MAX_TIMEOUT_MS,
		}),
	),
	maxResultBytes: Type.Optional(
		Type.Number({
			description: `Maximum bytes returned from the child final result. Default ${DEFAULT_MAX_RESULT_BYTES}.`,
			minimum: MIN_MAX_RESULT_BYTES,
			maximum: MAX_MAX_RESULT_BYTES,
		}),
	),
	includeDiagnostics: Type.Optional(
		Type.Boolean({ description: "Include bounded child diagnostics in failure results. Default false.", default: false }),
	),
};

export const ReaderParamsSchema = Type.Object({
	...BaseParamsProperties,
	task: Type.String({ description: "Self-contained read-only task to delegate to the child agent" }),
	continueSession: Type.Optional(Type.Boolean({
		description: "Continue a named persistent reader session. Default false; fresh context is used by default.",
		default: false,
	})),
	sessionKey: Type.Optional(Type.String({
		description: "Required when continueSession is true. Names the reader investigation thread.",
	})),
}, { additionalProperties: false });

export const WriterParamsSchema = Type.Object({
	...BaseParamsProperties,
	task: Type.String({ description: "Implementation-ready change brief for exact allowed files" }),
	allowedPaths: Type.Array(Type.String({ description: "Exact file path the writer may read or modify" }), {
		description: "Non-empty exact file paths. Directory scopes are not allowed.",
		minItems: 1,
	}),
}, { additionalProperties: false });
