import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Test-only oracle. Never import this module from the extension runtime.
const target = process.env.PI_SESSION_PROJECTION_PACKAGE_ROOT;

// An explicit package root lets preflight tests use disposable packages, not the installation.
export async function loadTargetSessionManager(packageRoot = target): Promise<Pick<typeof import("@earendil-works/pi-coding-agent"), "buildSessionProjection" | "SessionManager">> {
  assert.ok(packageRoot && path.isAbsolute(packageRoot), "select an isolated exact Pi 1.5.2 package");
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, "@earendil-works/pi-coding-agent");
  assert.equal(manifest.version, "1.5.2", "projection tests require exact Pi 1.5.2, not a fallback version");
  const manager = await import(pathToFileURL(path.join(packageRoot, "dist", "core", "session-manager.js")).href);
  assert.equal(typeof manager.buildSessionProjection, "function", "target projection helper must be available");
  assert.equal(typeof manager.SessionManager?.open, "function", "target session writer must be available");
  return manager;
}
