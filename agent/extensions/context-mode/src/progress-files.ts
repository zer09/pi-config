import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";

type FileSample = { dev: number; ino: number; birthtimeMs: number; size: number };
type FileState = { seen: boolean; last?: FileSample };

export class ProgressFiles {
  private states: FileState[];
  bytes = 0;

  constructor(private paths: string[]) {
    this.states = paths.map(() => ({ seen: false }));
  }

  async poll(baseline = false): Promise<number> {
    const samples = await Promise.all(this.paths.map(async (path) => {
      try {
        const value = await stat(path);
        // Metadata alone is enough. Ignore directories and files without read permission.
        if (!value.isFile() || (value.mode & 0o444) === 0) return { seen: true };
        await access(path, constants.R_OK);
        return { seen: true, last: { dev: value.dev, ino: value.ino, birthtimeMs: value.birthtimeMs, size: value.size } };
      } catch (error) {
        return { seen: (error as NodeJS.ErrnoException).code !== "ENOENT" };
      }
    }));
    for (const [index, sample] of samples.entries()) {
      const previous = this.states[index];
      if (!baseline && sample.last) {
        let growth = 0;
        if (!previous.seen) growth = sample.last.size;
        else if (previous.last?.dev === sample.last.dev && previous.last.ino === sample.last.ino && previous.last.birthtimeMs === sample.last.birthtimeMs) {
          growth = Math.max(0, sample.last.size - previous.last.size);
        }
        this.bytes = Math.min(Number.MAX_SAFE_INTEGER, this.bytes + growth);
      }
      // Shrinks reset the size baseline. Replacements and recovered access are
      // baselined too, so old bytes cannot become new work after a gap.
      this.states[index] = { seen: previous.seen || sample.seen, last: sample.last };
    }
    return this.bytes;
  }
}
