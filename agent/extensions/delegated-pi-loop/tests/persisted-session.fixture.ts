import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

/** Local fake-Pi storage only. Call the returned writer after emitting prompt success, as Pi does. */
export function createFixtureSession(args: readonly string[]): (text: string) => void {
  const index = args.indexOf("--session");
  if (index < 0) return () => {};
  const file = args[index + 1]!;
  const text = readFileSync(file, "utf8");
  if (text.length === 0) {
    appendFileSync(file, `${JSON.stringify({ type: "session", version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: process.cwd() })}\n`);
  } else if (!text.endsWith("\n")) {
    appendFileSync(file, "\n");
  }
  const entries = text.split("\n").flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  let parentId = entries.filter((entry) => entry.type !== "session").at(-1)?.id ?? null;
  return (text) => {
    const id = randomBytes(4).toString("hex");
    appendFileSync(file, `${JSON.stringify({ type: "message", id, parentId, timestamp: new Date().toISOString(), message: { role: "user", content: text, timestamp: Date.now() } })}\n`);
    parentId = id;
  };
}
