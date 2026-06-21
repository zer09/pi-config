import type { FileRecord } from "@colbymchenry/codegraph";
import { normalizeSlashes } from "../../paths.ts";
import { formatSize } from "../../result.ts";
import type { FilePage, FilesRenderOptions, NormalizedFilters } from "./types.ts";

export function renderFilesOutput(options: FilesRenderOptions): string {
  const lines = formatHeader(options);

  if (options.total === 0) {
    lines.push("", "No files indexed. Run CodeGraph indexing first, or use codegraph_status to inspect index state.");
    return lines.join("\n");
  }

  if (options.matched === 0) {
    lines.push("", "No indexed files match the provided filters.");
    return lines.join("\n");
  }

  if (options.page.files.length === 0) {
    lines.push("", `No files on this page. Matched ${options.matched} files, but offset is ${options.page.offset}.`);
    lines.push(...formatPaginationFooter(options.page, options.matched));
    return lines.join("\n");
  }

  lines.push("");
  switch (options.format) {
    case "flat":
      lines.push(...formatFilesFlat(options.page.files, options.includeMetadata, options.includeStats));
      break;
    case "grouped":
      lines.push(...formatFilesGrouped(options.page.files, options.includeMetadata, options.includeStats));
      break;
    case "tree":
    default:
      lines.push(...formatFilesTree(options.page.files, options.includeMetadata, options.includeStats, options.maxDepth));
      break;
  }
  lines.push(...formatPaginationFooter(options.page, options.matched));
  return lines.join("\n");
}

function formatHeader(options: FilesRenderOptions): string[] {
  const shown = options.page.files.length;
  const showing = shown > 0 ? `${options.page.offset + 1}-${options.page.offset + shown}` : "0";
  const lines = [
    "# Indexed files",
    "",
    `- root: ${options.root}`,
    `- total indexed files: ${options.total}`,
    `- matched files: ${options.matched}`,
    `- showing: ${showing}`,
    `- format: ${options.format}`,
  ];
  const filters = formatActiveFilters(options.filters);
  if (filters.length) {
    lines.push("- filters:");
    lines.push(...filters.map((filter) => `  - ${filter}`));
  }
  return lines;
}

function formatActiveFilters(filters: NormalizedFilters): string[] {
  const lines: string[] = [];
  if (filters.pathInput !== undefined) {
    lines.push(`path: ${JSON.stringify(filters.pathInput)}${filters.pathFilter ? ` → ${filters.pathFilter}` : " → <root>"}`);
  }
  if (filters.pattern) lines.push(`pattern: ${JSON.stringify(filters.pattern)}`);
  if (filters.query) lines.push(`query: ${JSON.stringify(filters.query)}`);
  if (filters.language) lines.push(`language: ${JSON.stringify(filters.language)}`);
  if (filters.errorsOnly) lines.push("errorsOnly: true");
  return lines;
}

function formatPaginationFooter(page: FilePage, matched: number): string[] {
  const lines: string[] = [];
  if (page.offsetOnlyDefault) {
    lines.push("", `No \`limit\` was provided with \`offset\`; using ${page.limit} files for this page.`);
  }
  if (page.limit !== undefined && page.offset + page.files.length < matched) {
    lines.push("", `Showing ${page.files.length} of ${matched} matched files. Increase \`offset\` to ${page.offset + page.files.length} for the next page.`);
  }
  return lines;
}

function formatFilesFlat(files: readonly FileRecord[], includeMetadata: boolean, includeStats: boolean): string[] {
  const lines = ["## Files", ""];
  for (const file of files) {
    if (includeStats) {
      lines.push(`- ${file.path}`);
      lines.push(...formatFileStats(file));
    } else if (includeMetadata) {
      lines.push(`- ${file.path} (${formatCompactMetadata(file, { includeLanguage: true })})`);
    } else {
      lines.push(`- ${file.path}`);
    }
  }
  return lines;
}

function formatFilesGrouped(files: readonly FileRecord[], includeMetadata: boolean, includeStats: boolean): string[] {
  const byLanguage = new Map<string, FileRecord[]>();
  for (const file of files) {
    const language = String(file.language);
    const existing = byLanguage.get(language) ?? [];
    existing.push(file);
    byLanguage.set(language, existing);
  }

  const lines = ["## Files by Language", ""];
  const groups = [...byLanguage.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [language, languageFiles] of groups) {
    lines.push(`### ${language} (${languageFiles.length})`);
    for (const file of languageFiles.sort(compareFilePath)) {
      if (includeStats) {
        lines.push(`- ${file.path}`);
        lines.push(...formatFileStats(file));
      } else if (includeMetadata) {
        lines.push(`- ${file.path} (${formatCompactMetadata(file, { includeLanguage: false })})`);
      } else {
        lines.push(`- ${file.path}`);
      }
    }
    lines.push("");
  }
  return trimTrailingBlank(lines);
}

function formatFilesTree(files: readonly FileRecord[], includeMetadata: boolean, includeStats: boolean, maxDepth?: number): string[] {
  interface TreeNode {
    readonly name: string;
    readonly children: Map<string, TreeNode>;
    file?: FileRecord;
  }

  const root: TreeNode = { name: "", children: new Map() };
  for (const file of files) {
    const parts = normalizeSlashes(file.path).split("/").filter(Boolean);
    let current = root;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]!;
      if (!current.children.has(part)) current.children.set(part, { name: part, children: new Map() });
      current = current.children.get(part)!;
      if (i === parts.length - 1) current.file = file;
    }
  }

  const lines = ["## Project Structure", ""];
  const renderNode = (node: TreeNode, prefix: string, isLast: boolean, depth: number): void => {
    if (maxDepth !== undefined && depth > maxDepth) return;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";

    if (node.name) {
      let line = prefix + connector + node.name;
      if (node.file && (includeMetadata || includeStats)) {
        line += ` (${formatCompactMetadata(node.file, { includeLanguage: true, includeStats })})`;
      }
      lines.push(line);
    }

    const children = [...node.children.values()].sort((a, b) => {
      const aIsDir = a.children.size > 0 && !a.file;
      const bIsDir = b.children.size > 0 && !b.file;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]!;
      const nextPrefix = node.name ? prefix + childPrefix : prefix;
      renderNode(child, nextPrefix, i === children.length - 1, depth + 1);
    }
  };

  renderNode(root, "", true, 0);
  return lines;
}

function formatCompactMetadata(file: FileRecord, options: { readonly includeLanguage: boolean; readonly includeStats?: boolean }): string {
  const parts: string[] = [];
  if (options.includeLanguage) parts.push(String(file.language));
  parts.push(plural(file.nodeCount, "symbol"));
  const errors = errorCount(file);
  if (errors > 0 || options.includeStats) parts.push(plural(errors, "error"));
  if (options.includeStats) {
    parts.push(formatSize(file.size));
    parts.push(`modified ${formatTimestamp(file.modifiedAt)}`);
    parts.push(`indexed ${formatTimestamp(file.indexedAt)}`);
  }
  return parts.join(", ");
}

function formatFileStats(file: FileRecord): string[] {
  return [
    `  - language: ${file.language}`,
    `  - symbols: ${file.nodeCount}`,
    `  - size: ${formatSize(file.size)}`,
    `  - modifiedAt: ${formatTimestamp(file.modifiedAt)}`,
    `  - indexedAt: ${formatTimestamp(file.indexedAt)}`,
    `  - errors: ${errorCount(file)}`,
  ];
}

function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "unknown";
  try {
    return new Date(ms).toISOString();
  } catch {
    return "unknown";
  }
}

function errorCount(file: FileRecord): number {
  return file.errors?.length ?? 0;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function trimTrailingBlank(lines: string[]): string[] {
  while (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function compareFilePath(a: FileRecord, b: FileRecord): number {
  return a.path.localeCompare(b.path);
}
