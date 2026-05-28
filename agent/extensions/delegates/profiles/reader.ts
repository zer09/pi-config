import { DEFAULT_READER_MODEL, DEFAULT_THINKING } from "../constants.ts";
import { normalizeReaderParams } from "../params.ts";
import { ReaderParamsSchema } from "../schemas.ts";
import { READER_TOOLS } from "../toolsets.ts";
import type { DelegateProfile, NormalizedReaderParams, ReaderParams } from "../types.ts";

export const readerProfile: DelegateProfile<ReaderParams, NormalizedReaderParams> = {
	name: "reader",
	capability: "read",
	label: "Reader",
	description: "Run a read-only delegate agent in a child Pi process and return a compact summary.",
	promptSnippet: "Delegate a bounded read-only investigation task to a user-level Pi agent with isolated context.",
	promptGuidelines: [
		"Use reader only for isolated investigation, review, testing, documentation research, or consistency checks that are worth child startup overhead.",
		"Reader uses fresh context by default; set continueSession with a non-secret sessionKey only for deliberate follow-ups in the same investigation thread.",
		"Do not continue reader sessions for independent reviews or unrelated tasks.",
		"Make the task self-contained with file paths, exact questions, and expected output.",
		"Do not use reader recursively; child sessions disable delegate tools with PI_DELEGATE_CHILD=1.",
	],
	parameters: ReaderParamsSchema,
	tools: READER_TOOLS,
	sessionDirSegment: "reader",
	sessionMode: "fresh",
	defaultModel: DEFAULT_READER_MODEL,
	defaultThinking: DEFAULT_THINKING,
	normalizeParams: normalizeReaderParams,
};
