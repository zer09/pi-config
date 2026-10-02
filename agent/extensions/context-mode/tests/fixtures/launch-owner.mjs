import { runOwner } from "../../src/worker.mjs";

runOwner((pid) => {
  process.send({ type: "launch-held", pid });
  // The outer test cancels or disconnects before this finite failure deadline.
  return new Promise((_, reject) => setTimeout(() => reject(new Error("launch boundary expired")), 5000));
});
