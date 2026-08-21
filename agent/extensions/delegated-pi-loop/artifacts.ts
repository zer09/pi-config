import { chmod, lstat, mkdir, mkdtemp, open, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Model-visible delegate output bound shared by the runner and result builders. */
export const DELEGATE_TOOL_OUTPUT_LIMIT = 50 * 1024;

export function safeLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 64) || "delegate";
}

export async function createArtifactDir(label: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), `delegated-pi-${safeLabel(label)}-`));
  await chmod(directory, 0o700);
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
