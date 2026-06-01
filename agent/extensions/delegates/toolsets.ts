export const READER_TOOLS = [
	"ctx_execute",
	"ctx_execute_file",
	"ctx_batch_execute",
	"ctx_search",
	"ctx_fetch_and_index",
	"ctx_index",
	"ctx_stats",
	"ctx_doctor",
	"context_mode_ctx_execute",
	"context_mode_ctx_execute_file",
	"context_mode_ctx_batch_execute",
	"context_mode_ctx_search",
	"context_mode_ctx_fetch_and_index",
	"context_mode_ctx_index",
	"context_mode_ctx_stats",
	"context_mode_ctx_doctor",
] as const;

export const WRITER_TOOLS = ["read", "edit", "write"] as const;
