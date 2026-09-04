#!/usr/bin/env node
import { loadRoutingSnapshot, roleIds, selectRoutes } from "./routing.ts";
import { routeKey } from "./routes.ts";

try {
  const routing = loadRoutingSnapshot();
  const roles = roleIds(routing);
  console.log(
    `routing.json is valid: ${Object.keys(routing.models).length} models, ${Object.keys(routing.profiles).length} profiles, ${roles.length} roles`,
  );
  for (const role of roles) {
    const routes = selectRoutes(routing, role, undefined, { random: () => 0 });
    console.log(`${role}: ${routes.map(routeKey).join(" -> ")}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
