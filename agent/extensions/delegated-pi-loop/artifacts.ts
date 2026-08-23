import { chmod, lstat, mkdir, mkdtemp, open, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Model-visible delegate output bound shared by the runner and result builders. */
export const DELEGATE_TOOL_OUTPUT_LIMIT = 50 * 1024;

export function safeLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 64) || "delegate";
}

/** Applies the private permission set to a freshly created artifact directory. */
async function chmodPrivate(directory: string): Promise<void> {
  await chmod(directory, 0o700);
}

/**
 * Parent directory for supervision artifacts. `PI_DELEGATE_ARTIFACT_PARENT`
 * is a narrow test-injection seam so a test process can own one unique
 * sandbox instead of sharing the real tmpdir; it is never model-visible and
 * never set outside tests, which default to the operating system tmpdir.
 */
export function artifactParentDirectory(): string {
  return process.env.PI_DELEGATE_ARTIFACT_PARENT || os.tmpdir();
}

/**
 * Creates the private supervision artifact directory. The permission step is
 * injectable only so tests can fault-inject its failure; the default keeps
 * the 0700 permission requirement.
 */
export async function createArtifactDir(
  label: string,
  applyPrivatePermissions: (directory: string) => Promise<void> = chmodPrivate,
): Promise<string> {
  const directory = await mkdtemp(path.join(artifactParentDirectory(), `delegated-pi-${safeLabel(label)}-`));
  try {
    await applyPrivatePermissions(directory);
  } catch (error) {
    // mkdtemp succeeded but the directory is not provably private: remove it
    // best-effort and surface the original permission error instead of
    // leaking an unrestricted artifact directory.
    await removeDirectory(directory);
    throw error;
  }
  return directory;
}

export async function createPrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { mode: 0o700, recursive: false });
  await chmod(directory, 0o700);
}

export async function atomicWriteText(filePath: string, content: string): Promise<void> {
  const directory = path.dirname(filePath);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content.endsWith("\n") || !content ? content : `${content}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, filePath);
}

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await atomicWriteText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

/** Best-effort recursive removal of a supervision artifact directory. */
export async function removeDirectory(directory: string): Promise<void> {
  try {
    await rm(directory, { recursive: true, force: true });
  } catch {
    // Temporary supervision artifacts may outlive the run when the platform
    // refuses removal; the operating system owns tmpdir cleanup afterward.
  }
}

export async function readPrivateText(filePath: string): Promise<string> {
  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`unsafe artifact file: ${filePath}`);
  return readFile(filePath, "utf8");
}

export function truncateUtf8(value: string, maxBytes: number): { text: string; truncatedBytes: number } {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) return { text: value, truncatedBytes: 0 };
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  return {
    text: buffer.subarray(0, end).toString("utf8"),
    truncatedBytes: buffer.byteLength - end,
  };
}
