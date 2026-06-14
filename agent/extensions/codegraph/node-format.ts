/**
 * Formatting helpers for CodeGraph nodes, references, and impact subgraphs.
 *
 * These helpers are pure markdown/text transformations shared by the symbol,
 * callers, callees, impact, and node tools.
 */

import type { Edge, Node, Subgraph } from "@colbymchenry/codegraph";

function nodeLocation(node: Node, lineOverride?: number): string {
  const line = lineOverride ?? node.startLine;
  const end = node.endLine && node.endLine !== line ? `-${node.endLine}` : "";
  return `${node.filePath}:${line}${end}`;
}

/**
 * Format a node as a section title with kind, name, location, and signature.
 *
 * @param node - CodeGraph node to describe.
 * @returns One-line title for headings and diagnostics.
 */
export function nodeTitle(node: Node): string {
  const sig = node.signature ? ` — ${node.signature}` : "";
  return `${node.kind} ${node.qualifiedName || node.name} — ${nodeLocation(node)}${sig}`;
}

/** Options used to render one node line. */
export interface FormatNodeLineOptions {
  /** Optional search score to append. */
  readonly score?: number;
  /** Optional line override, usually from an edge reference. */
  readonly line?: number;
  /** Optional edge/reference label. */
  readonly label?: string;
}

/**
 * Format a CodeGraph node as a markdown bullet.
 *
 * @param node - Node to render.
 * @param options - Optional score, line override, and label.
 * @returns Markdown bullet line.
 */
export function formatNodeLine(node: Node, options: FormatNodeLineOptions = {}): string {
  const label = options.label ? ` [${options.label}]` : "";
  const score = typeof options.score === "number" ? ` score=${options.score.toFixed(2)}` : "";
  const sig = node.signature ? ` — ${node.signature}` : "";
  return `- ${node.kind} ${node.qualifiedName || node.name}${label} — ${nodeLocation(node, options.line)}${sig}${score}`;
}

/** Reference pair returned by CodeGraph caller/callee queries. */
export interface NodeReference {
  /** Referenced node. */
  readonly node: Node;
  /** Edge connecting the referenced node. */
  readonly edge: Edge;
}

/**
 * Format a caller/callee reference as a markdown bullet.
 *
 * @param ref - CodeGraph node/edge pair.
 * @param label - Optional label overriding the edge kind.
 * @returns Markdown bullet line.
 */
export function formatReferenceLine(ref: NodeReference, label?: string): string {
  const edgeLabel = label ?? ref.edge.kind;
  return formatNodeLine(ref.node, { line: ref.edge.line ?? ref.node.startLine, label: edgeLabel });
}

function groupNodesByFile(nodes: readonly Node[]): Map<string, Node[]> {
  const grouped = new Map<string, Node[]>();
  for (const node of nodes) {
    const list = grouped.get(node.filePath) ?? [];
    list.push(node);
    grouped.set(node.filePath, list);
  }
  return grouped;
}

/**
 * Format an impact-radius subgraph for a target node.
 *
 * @param target - Symbol whose impact is being displayed.
 * @param subgraph - CodeGraph impact subgraph.
 * @param limit - Maximum impacted nodes to show.
 * @returns Markdown impact report.
 */
export function formatSubgraphImpact(target: Node, subgraph: Subgraph, limit: number): string {
  const nodes = [...subgraph.nodes.values()]
    .filter((node) => node.id !== target.id)
    .sort((a, b) => a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine)
    .slice(0, limit);

  if (nodes.length === 0) {
    return `No impacted nodes found for ${nodeTitle(target)}.`;
  }

  const lines = [`## Impact for ${nodeTitle(target)}`, ""];
  const grouped = groupNodesByFile(nodes);
  for (const [file, fileNodes] of grouped) {
    lines.push(`### ${file}`);
    for (const node of fileNodes) lines.push(formatNodeLine(node));
    lines.push("");
  }
  const total = subgraph.nodes.size - 1;
  if (total > nodes.length) lines.push(`_Showing ${nodes.length} of ${total} impacted nodes. Narrow the symbol/file or lower depth for a smaller result._`);
  lines.push(`_Edges considered: ${subgraph.edges.length}; depth roots: ${subgraph.roots.length}._`);
  return lines.join("\n").trimEnd();
}
