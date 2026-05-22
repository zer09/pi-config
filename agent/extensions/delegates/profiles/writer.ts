import { DEFAULT_THINKING, DEFAULT_WRITER_MODEL } from "../constants.ts";
import { normalizeWriterParams } from "../params.ts";
import { WriterParamsSchema } from "../schemas.ts";
import { WRITER_TOOLS } from "../toolsets.ts";
import type { DelegateProfile, NormalizedWriterParams, WriterParams } from "../types.ts";

export const writerProfile: DelegateProfile<WriterParams, NormalizedWriterParams> = {
	name: "writer",
	capability: "write",
	label: "Writer",
	description: "Run a tightly scoped file-editing delegate agent in a child Pi process.",
	promptSnippet: "Delegate exact local file changes to a writer child agent with explicit allowedPaths.",
	promptGuidelines: [
		"Use writer only for implementation-ready local file changes.",
		"Provide non-empty exact file paths in allowedPaths; directory scopes are not allowed.",
		"The parent remains responsible for validation, review, commits, and hosted-service mutations.",
	],
	parameters: WriterParamsSchema,
	tools: WRITER_TOOLS,
	sessionDirSegment: "writer",
	sessionMode: "fresh",
	defaultModel: DEFAULT_WRITER_MODEL,
	defaultThinking: DEFAULT_THINKING,
	normalizeParams: normalizeWriterParams,
};
