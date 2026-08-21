import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readlink, realpath, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TreeFingerprint } from "./types.ts";

const execFileAsync = promisify(execFile);

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

export async function readPrivateText(filePath: string): Promise<string> {
  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`unsafe artifact file: ${filePath}`);
  return readFile(filePath, "utf8");
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function gitOutput(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.stdout;
}

async function hashUntrackedFiles(gitRoot: string): Promise<string> {
  const listing = await gitOutput(gitRoot, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const relativePaths = listing.split("\0").filter(Boolean).sort();
  const hash = createHash("sha256");
  for (const relativePath of relativePaths) {
    const absolutePath = path.resolve(gitRoot, relativePath);
    const relativeCheck = path.relative(gitRoot, absolutePath);
    if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
      throw new Error(`unsafe untracked path: ${relativePath}`);
    }
    const fileStat = await lstat(absolutePath);
    hash.update(`path\0${relativePath}\0mode\0${fileStat.mode}\0`);
    if (fileStat.isSymbolicLink()) {
      hash.update(`symlink\0${await readlink(absolutePath)}\0`);
      continue;
    }
    if (!fileStat.isFile()) {
      hash.update("non-file\0");
      continue;
    }
    for await (const chunk of createReadStream(absolutePath)) hash.update(chunk as Buffer);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function captureTreeFingerprint(cwd: string): Promise<TreeFingerprint | undefined> {
  let gitRoot: string;
  try {
    gitRoot = (await gitOutput(cwd, ["rev-parse", "--show-toplevel"])).trim();
  } catch {
    return undefined;
  }

  const canonicalRoot = await realpath(gitRoot);
  const [status, unstaged, staged, untrackedSha256] = await Promise.all([
    gitOutput(canonicalRoot, ["status", "--short"]),
    gitOutput(canonicalRoot, ["diff", "--binary"]),
    gitOutput(canonicalRoot, ["diff", "--cached", "--binary"]),
    hashUntrackedFiles(canonicalRoot),
  ]);
  return {
    gitRoot: canonicalRoot,
    status,
    unstagedSha256: sha256(unstaged),
    stagedSha256: sha256(staged),
    untrackedSha256,
  };
}

export function fingerprintsEqual(before: TreeFingerprint | undefined, after: TreeFingerprint | undefined): boolean {
  if (before === undefined || after === undefined) return before === after;
  return before.gitRoot === after.gitRoot
    && before.status === after.status
    && before.unstagedSha256 === after.unstagedSha256
    && before.stagedSha256 === after.stagedSha256
    && before.untrackedSha256 === after.untrackedSha256;
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
