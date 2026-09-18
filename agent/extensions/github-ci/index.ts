import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createQueries } from "./github.ts";
import { parameters, validateInput } from "./input.ts";
import { formatResult } from "./output.ts";
import { abortableSleep, watchRuns } from "./watch.ts";
import type { WatchDependencies } from "./types.ts";

export default function githubCiExtension(
  pi: Pick<ExtensionAPI, "registerTool" | "exec">,
  timing: Pick<WatchDependencies, "sleep" | "now"> = {
    sleep: abortableSleep,
    now: () => performance.now(),
  },
) {
  pi.registerTool({
    name: "github_ci_wait",
    label: "GitHub CI Wait",
    description:
      "Wait read-only for 1-10 GitHub Actions run IDs in OWNER/REPO. Polls every 15s (minimum 5s), times out after 1800s (maximum 86400s), and fails fast by default. Returns PASS, FAIL, TIMEOUT, or CANCELLED with latest attempts and bounded failure summaries. No logs or progress output. Results are capped at 24 lines and below 4 KB; extra failure details are omitted.",
    promptSnippet:
      "Wait for GitHub Actions runs with one compact result instead of shell polling loops.",
    parameters,
    prepareArguments: validateInput,
    async execute(_toolCallId, input, signal) {
      const details = await watchRuns(
        input,
        { ...createQueries(pi), ...timing },
        signal,
      );
      return {
        content: [{ type: "text", text: formatResult(details) }],
        details,
      };
    },
  });
}
