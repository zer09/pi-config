import rtkHookExtension from "./index.ts";

type Handler = (event: unknown) => Promise<void> | void;

type Case = {
	command: string;
	expected: string;
};

const cases: Case[] = [
	// Safe read-only commands that should use RTK's rewrite output.
	{ command: "git status", expected: "rtk git status" },
	{ command: "npx tsc", expected: "rtk tsc" },
	{ command: "rg TODO src", expected: "rtk grep TODO src" },
	{ command: "cat package.json", expected: "rtk read package.json" },
	{ command: "go test ./...", expected: "rtk go test ./..." },

	// Mutating or unsupported commands that must stay untouched.
	{ command: "git push", expected: "git push" },
	{ command: "git branch new-feature", expected: "git branch new-feature" },
	{ command: "kubectl apply -f x.yaml", expected: "kubectl apply -f x.yaml" },
	{ command: "pip install foo", expected: "pip install foo" },
	{ command: "ruff format", expected: "ruff format" },
	{ command: "docker compose up", expected: "docker compose up" },
	{ command: "psql -f migration.sql", expected: "psql -f migration.sql" },
	{ command: "docker compose config", expected: "docker compose config" },
	{ command: "dotnet format", expected: "dotnet format" },
	{ command: "rubocop -A", expected: "rubocop -A" },
	{ command: "terraform plan", expected: "terraform plan" },
	{ command: "tofu validate", expected: "tofu validate" },
	{ command: "swift test", expected: "swift test" },
];

async function main() {
	let handler: Handler | undefined;
	rtkHookExtension({
		on(name: string, callback: Handler) {
			if (name === "tool_call") handler = callback;
		},
	} as never);

	if (!handler) {
		throw new Error("rtk-hook did not register a tool_call handler");
	}

	let failures = 0;
	for (const testCase of cases) {
		const event = {
			type: "tool_call",
			toolCallId: "rtk-hook-smoke-test",
			toolName: "bash",
			input: { command: testCase.command },
		};

		await handler(event);

		const actual = event.input.command;
		if (actual !== testCase.expected) {
			failures += 1;
			console.error(`FAIL ${testCase.command} => ${actual}; expected ${testCase.expected}`);
		} else {
			console.log(`ok ${testCase.command} => ${actual}`);
		}
	}

	if (failures > 0) {
		throw new Error(`${failures} rtk-hook smoke case(s) failed`);
	}
}

await main();
