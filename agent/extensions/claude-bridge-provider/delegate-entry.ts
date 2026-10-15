/**
 * Delegated-child entry for the `claude-bridge` provider.
 *
 * Delegated Pi children start with extension discovery disabled, so the
 * `pi-claude-bridge` package never registers its provider there. This entry
 * loads the installed package so `claude-bridge/*` routes exist in catalog
 * preflight and runtime children.
 *
 * The file is deliberately not named `index.ts`: Pi auto-discovers
 * `index.ts` directories, and the parent session already loads the package
 * through `agent/settings.json`. Only the delegated resource policy loads
 * this entry, by explicit path.
 *
 * Every failure this entry handles (load, activation, a registration call
 * that throws, or a project config) leaves nothing registered and returns
 * normally. The entry is loaded by every delegated child, so a bridge
 * problem must only make `claude-bridge/*` routes unavailable, never stop a
 * child on another route. Pi validates queued providers later, outside this
 * entry: a rejection there goes to Pi's extension-error channel and leaves
 * the bridge's hooks registered (see `activateBridge`).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BRIDGE_ENTRY = new URL("../../npm/node_modules/pi-claude-bridge/src/index.ts", import.meta.url);

/** The only Pi APIs the bridge may use in a delegate; every other call is ignored. */
const FORWARDED_APIS: ReadonlySet<PropertyKey> = new Set(["on", "registerProvider"]);

/** Bounds the single stderr line so a hostile error message cannot flood the child log. */
const MAX_DIAGNOSTIC_LENGTH = 300;

export type BridgeFactory = (pi: ExtensionAPI) => unknown;

function report(reason: string): void {
	// Line breaks and other control characters become spaces, so an error
	// message can never forge extra log lines.
	const line = `claude-bridge-provider: ${reason}`.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ");
	console.error(line.slice(0, MAX_DIAGNOSTIC_LENGTH));
}

/** One held registration and how to undo it if a later registration fails. */
interface PendingRegistration {
	readonly register: () => unknown;
	readonly undo: (result: unknown) => void;
	cancelled: boolean;
	replayed: boolean;
	result?: unknown;
}

function errorText(error: unknown): string {
	// A thrown value can refuse conversion (no prototype, a throwing
	// `toString` or `message` getter). Reading it must never escape the
	// failure handling it is part of.
	try {
		return String(error instanceof Error ? error.message : error);
	} catch {
		return "unprintable error";
	}
}

/**
 * Activates the bridge with an allowlisted API and commits its registrations
 * only after activation succeeds. If a registration call throws while held
 * registrations are replayed, the ones already made are undone in reverse
 * order. During Pi's initial load, `registerProvider` only queues the
 * provider; Pi validates it later and reports a rejection through its own
 * extension-error channel, which this entry cannot undo.
 *
 * This entry limits what the bridge registers in Pi. It does not sandbox the
 * bridge: Claude Code still loads its own user, project, and local settings,
 * and the bridge re-reads its config later. ADR 0010 limits these routes to
 * trusted repositories for that reason.
 *
 * `cwd` must be the directory the bridge reads project config from (it uses
 * `process.cwd()`). A project `.pi/claude-bridge.json` can override global
 * settings, including the Claude Code executable and MCP isolation, so the
 * bridge is not loaded at all when one exists.
 */
export async function activateBridge(
	pi: ExtensionAPI,
	loadBridge: () => Promise<BridgeFactory>,
	cwd: string,
): Promise<void> {
	if (existsSync(path.join(cwd, ".pi", "claude-bridge.json"))) {
		report("project .pi/claude-bridge.json found; claude-bridge is not loaded in delegated children");
		return;
	}

	// Registrations wait in `pending` until activation succeeds, so a bridge
	// that throws halfway leaves no hooks or provider behind. After commit,
	// later calls (the bridge registers from a session_start handler in one
	// case) go straight to Pi.
	let state: "activating" | "replaying" | "committed" | "failed" = "activating";
	const pending: PendingRegistration[] = [];
	const api = new Proxy({} as ExtensionAPI, {
		get(_target, key) {
			if (!FORWARDED_APIS.has(key)) return () => {};
			return (...args: unknown[]) => {
				const register = () => (Reflect.get(pi, key) as (...args: unknown[]) => unknown).apply(pi, args);
				if (state === "committed") return register();
				if (key === "registerProvider") {
					if (state !== "failed") pending.push(heldRegistration(register, () => pi.unregisterProvider(providerId(args[0]))));
					return undefined;
				}
				// `on` returns an unsubscribe function; keep that contract while held.
				if (state === "failed") return () => {};
				const item = heldRegistration(register, (result) => {
					if (typeof result === "function") result();
				});
				pending.push(item);
				return () => {
					item.cancelled = true;
					if (item.replayed) item.undo(item.result);
				};
			};
		},
	});

	let bridge: BridgeFactory;
	try {
		bridge = await loadBridge();
	} catch (error) {
		state = "failed";
		report(`cannot load pi-claude-bridge (${errorText(error)})`);
		return;
	}
	try {
		await bridge(api);
	} catch (error) {
		state = "failed";
		report(`pi-claude-bridge activation failed (${errorText(error)})`);
		return;
	}
	// Calls made while replaying are appended to `pending`, and the index loop
	// reaches them in order.
	state = "replaying";
	const replayed: PendingRegistration[] = [];
	try {
		for (let index = 0; index < pending.length; index += 1) {
			const item = pending[index]!;
			if (item.cancelled) continue;
			item.result = item.register();
			item.replayed = true;
			replayed.push(item);
		}
	} catch (error) {
		state = "failed";
		for (const item of replayed.reverse()) {
			try {
				item.undo(item.result);
			} catch {
				// Keep undoing the rest; the failure is reported once below.
			}
		}
		report(`claude-bridge registration failed (${errorText(error)})`);
		return;
	}
	state = "committed";
}

function heldRegistration(register: () => unknown, undo: (result: unknown) => void): PendingRegistration {
	return { register, undo, cancelled: false, replayed: false };
}

/**
 * The identity `unregisterProvider` expects. `registerProvider` takes either
 * `(name, config)` or a native provider object, which Pi keys by `id`; its
 * `name` is only a display label.
 */
function providerId(first: unknown): string {
	return typeof first === "string" ? first : String((first as { id?: unknown } | undefined)?.id);
}

export default function (pi: ExtensionAPI): Promise<void> {
	return activateBridge(pi, async () => (await import(BRIDGE_ENTRY.href)).default as BridgeFactory, process.cwd());
}
