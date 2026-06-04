import { Type } from "typebox";

export const OPTIONAL_LIMIT = Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 10, description: "Maximum results" }));
export const OPTIONAL_PROJECT = Type.Optional(Type.String({ description: "Project identifier" }));

export const STRING_OR_STRING_ARRAY = (description: string) => Type.Union([
  Type.String({ description }),
  Type.Array(Type.String(), { description }),
]);

export const GATED_CONFIRM = (phrase: string) => Type.String({ description: `Required exact confirmation phrase: ${phrase}` });
