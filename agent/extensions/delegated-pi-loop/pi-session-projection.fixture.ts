import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Test-only oracle. Never import this module from the extension runtime.
const target = path.join(os.homedir(), ".bun", "install", "global", "node_modules", "@earendil-works", "pi-coding-agent");

// An explicit package root lets preflight tests use disposable packages, not the installation.
export async function loadTargetSessionManager(packageRoot = target): Promise<Pick<typeof import("@earendil-works/pi-coding-agent"), "buildSessionProjection" | "SessionManager">> {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, "@earendil-works/pi-coding-agent");
  assert.equal(manifest.version, "0.99.2", "projection tests require installed Pi 0.99.2, not a fallback version");
  const manager = await import(pathToFileURL(path.join(packageRoot, "dist", "core", "session-manager.js")).href);
  assert.equal(typeof manager.buildSessionProjection, "function", "target projection helper must be available");
  assert.equal(typeof manager.SessionManager?.open, "function", "target session writer must be available");
  return manager;
}
