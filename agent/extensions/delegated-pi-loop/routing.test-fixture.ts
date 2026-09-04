import { fileURLToPath } from "node:url";
import { readRoutingConfigFile, type RoutingConfig } from "./routing.ts";

const fixturePath = fileURLToPath(new URL("./routing.fixture.json", import.meta.url));

/** Stable policy fixture for tests that exercise concrete route combinations. */
export function loadRoutingFixture(): RoutingConfig {
  return readRoutingConfigFile(fixturePath);
}
