import { Type } from "typebox";
import { MAX_CODEGRAPH_QUERY_CHARS } from "../constants.ts";
import { ProjectPathSchema } from "../tool-parameters.ts";

export const ExploreToolParameters = Type.Object(
  {
    query: Type.String({
      description: "Symbol names, file paths, or short code terms to explore. Exact identifiers improve precision; a natural-language question also works.",
      minLength: 1,
      maxLength: MAX_CODEGRAPH_QUERY_CHARS,
    }),
    maxFiles: Type.Optional(Type.Integer({
      description: "Maximum files whose source may be included. Omit for CodeGraph's project-size-adaptive default.",
      minimum: 1,
      maximum: 20,
    })),
    projectPath: ProjectPathSchema,
  },
  { additionalProperties: false },
);
