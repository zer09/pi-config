/**
 * Runtime interop with the `@colbymchenry/codegraph` package.
 *
 * CodeGraph's npm entry can be resolved through a CommonJS-compatible shim even
 * when Pi loads this TypeScript extension as ESM. This file isolates that
 * package-loading detail so the rest of the extension can use named exports.
 */

import { createRequire } from "node:module";
import type * as CodeGraphTypes from "@colbymchenry/codegraph";
import type { CodeGraphInstance } from "./types.ts";

type CodeGraphPackage = typeof CodeGraphTypes & {
  readonly default?: typeof CodeGraphTypes.CodeGraph;
};

const nodeRequire = createRequire(import.meta.url);
const codegraphModule = nodeRequire("@colbymchenry/codegraph") as CodeGraphPackage;

/** CodeGraph class constructor loaded from the installed package. */
export const CodeGraph = (codegraphModule.CodeGraph ?? codegraphModule.default) as typeof CodeGraphTypes.CodeGraph;

/** Locate the nearest initialized CodeGraph project root from a starting path. */
export const findNearestCodeGraphRoot = codegraphModule.findNearestCodeGraphRoot as (startPath: string) => string | null;

/** Convenience type for an open CodeGraph instance. */
export type { CodeGraphInstance };
