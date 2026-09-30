import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import vm from "node:vm"

const skillDir = join(import.meta.dir, "..")
const read = (path: string) => readFileSync(join(skillDir, path), "utf8")
const generator = read("scripts/generate-docs.ts")
const template = read("SKILL.template.md")
const skill = read("SKILL.md")

function help(path: string, commands = "") {
  return `\x1b[1mUsage:\x1b[0m linear ${path}  \nVersion: 2.6.0  \n\nDescription:\n\n  Offline fixture  \n\nOptions:\n\n  --help - Show help.  \n${commands}`
}

const fixtures: Record<string, string> = {
  "": help(
    "",
    "\nCommands:\n\n  issue, i - Issues\n  completions - Shell\n  markdown - Markdown\n  auth - Authentication\n",
  ),
  issue: help(
    "issue",
    "\nCommands:\n\n  update - Update\n  comment - Comments\n",
  ),
  "issue update": help("issue update <id>"),
  "issue comment": help("issue comment", "\nCommands:\n\n  add - Add\n"),
  "issue comment add": help("issue comment add <id>"),
  markdown: help("markdown"),
  auth: help("auth", "\nCommands:\n\n  token - Show API token\n"),
  "auth token": help("auth token"),
}

// Run the real generator in memory. No subprocess, network, or credential path
// is available to these mocks, including the token-help fixture.
function harness(options: {
  fail?: string
  missingTemplate?: boolean
  helpByPath?: Record<string, string>
} = {}) {
  const calls: string[][] = []
  const writes = new Map<string, string>()
  const removed: string[] = []
  const helpByPath = options.helpByPath ?? fixtures
  const context = vm.createContext({
    dirname,
    join,
    URL,
    TextDecoder,
    SOURCE_URL: "file:///skill/scripts/generate-docs.ts",
    console: { log() {} },
    Deno: {
      Command: class {
        constructor(private bin: string, private options: { args: string[] }) {}
        async output() {
          const args = [this.bin, ...this.options.args]
          calls.push(args)
          const key = args.join(" ")
          let stdout = ""
          if (key === "linear --version") {
            stdout = "linear 2.6.0"
          } else if (this.bin === "linear" && args.at(-1) === "--help") {
            const path = args.slice(1, -1).join(" ")
            if (!(path in helpByPath)) {
              throw new Error(`Unexpected help: ${path}`)
            }
            stdout = helpByPath[path]
          } else if (
            key !== "deno fmt --prose-wrap=never --no-semicolons /skill"
          ) {
            throw new Error(`Forbidden command: ${key}`)
          }
          return {
            success: key !== options.fail,
            stdout: new TextEncoder().encode(stdout),
            stderr: new TextEncoder().encode(
              key === options.fail ? "mock failure" : "",
            ),
          }
        }
      },
      async readTextFile(path: string) {
        if (path !== "/skill/SKILL.template.md" || options.missingTemplate) {
          throw new Error("Missing template")
        }
        return template
      },
      async mkdir() {},
      async writeTextFile(path: string, content: string) {
        writes.set(path, content)
      },
      async *readDir() {
        yield { name: "organization-features.md", isFile: true }
        yield { name: "obsolete.md", isFile: true }
        yield { name: "nested", isFile: false }
      },
      async remove(path: string) {
        removed.push(path)
      },
    },
  })
  const source = generator
    .replace(/^import .* from "node:path"\n/m, "")
    .replaceAll("import.meta.url", "SOURCE_URL")
    .replace("import.meta.main", "false")
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(source)
  const api = vm.runInContext(
    `${js}\n({ main, parseCommands, normalizeHelp, stripAnsi })`,
    context,
  )
  return { ...api, calls, writes, removed }
}

describe("offline documentation generator", () => {
  test("discovers aliases and nested help, sorts output, and preserves local overlays", async () => {
    const h = harness()
    await h.main()
    expect(h.calls.filter((args: string[]) => args.at(-1) === "--help"))
      .toHaveLength(8)
    expect(h.calls.some((args: string[]) => args.includes("completions"))).toBe(
      false,
    )
    expect(h.calls.at(-1)).toEqual([
      "deno",
      "fmt",
      "--prose-wrap=never",
      "--no-semicolons",
      "/skill",
    ])
    expect(h.removed).toEqual(["/skill/references/obsolete.md"])
    const index = h.writes.get("/skill/references/commands.md")!
    expect(index.indexOf("[auth]")).toBeLessThan(index.indexOf("[issue]"))
    expect(index).toContain("Start with the linked command-family reference")
    expect(h.writes.get("/skill/references/issue.md")).toContain("##### add")
    for (const text of h.writes.values()) {
      expect(text).not.toMatch(/Version:|\x1b|[ \t]+$/m)
      expect(text).not.toContain("{{REFERENCE_TOC}}")
    }
  })

  test.each([
    "linear --version",
    "linear --help",
    "linear issue comment add --help",
  ])(
    "aborts before writing when %s fails",
    async (fail) => {
      const h = harness({ fail })
      await expect(h.main()).rejects.toThrow(/failed|Aborting/)
      expect(h.writes.size).toBe(0)
      expect(h.removed).toEqual([])
    },
  )

  test("missing template does not prune or write references", async () => {
    const h = harness({ missingTemplate: true })
    await expect(h.main()).rejects.toThrow("Missing template")
    expect(h.writes.size).toBe(0)
    expect(h.removed).toEqual([])
  })

  test("formatter failure is reported", async () => {
    const h = harness({
      fail: "deno fmt --prose-wrap=never --no-semicolons /skill",
    })
    await expect(h.main()).rejects.toThrow("Failed to format")
  })

  test("all bundled help is reachable and round-trips through the generator", async () => {
    const index = read("references/commands.md")
    const families = [
      ...index.matchAll(/^- \[([^\]]+)\]\(\.\/[^)]+\) - (.+)$/gm),
    ]
    const helpByPath: Record<string, string> = {
      "": help(
        "",
        `\nCommands:\n\n${
          families.map((m) => `  ${m[1]} - ${m[2]}`).join("\n")
        }\n`,
      ),
    }
    for (const [, family] of families) {
      const reference = read(`references/${family}.md`)
      for (const match of reference.matchAll(/```\n(Usage:[\s\S]*?)\n```/g)) {
        const usage = match[1].split("\n")[0].replace(/^Usage:\s+linear\s*/, "")
        const path = usage.match(/^[a-z][-a-z]*(?: [a-z][-a-z]*)*/)?.[0]
        expect(path).toBeDefined()
        expect(helpByPath[path!]).toBeUndefined()
        helpByPath[path!] = match[1]
      }
    }
    const h = harness({ helpByPath })
    await h.main()
    expect(h.calls.filter((args: string[]) => args.at(-1) === "--help"))
      .toHaveLength(Object.keys(helpByPath).length)
    for (const [, family] of families) {
      expect(h.writes.get(`/skill/references/${family}.md`)).toBe(
        read(`references/${family}.md`),
      )
    }
    expect(h.writes.get("/skill/SKILL.md")).toBe(skill)
  })
})

describe("local runtime safety and discovery contract", () => {
  test("template and compact runtime stay synchronized", () => {
    const toc = skill.match(/^- \[api\][\s\S]*?^- \[user\].*$/m)![0]
    expect(template.replace("{{REFERENCE_TOC}}", toc)).toBe(skill)
    expect(skill.split("\n").length).toBeLessThan(500)
    expect(skill).not.toContain("## Available Commands")
  })

  test("draft regression retains reference-first syntax and no mutation", () => {
    const evals = JSON.parse(read("evals/evals.json"))
    const regression = evals.evals.find((entry: { id: string }) =>
      entry.id === "reference-first-update-draft"
    )
    expect(regression.expected_output).toContain(
      'linear issue update ENG-123 --title "Fix OAuth callback"',
    )
    expect(
      regression.assertions.every((entry: { critical: boolean }) =>
        entry.critical
      ),
    ).toBe(true)
    expect(skill.indexOf("Open the smallest bundled family reference"))
      .toBeLessThan(skill.indexOf("Consult live"))
    expect(read("references/issue.md")).toMatch(
      /Usage:\s+linear issue update \[issueId\]/,
    )
    expect(read("references/issue.md")).toContain("--title")
  })

  test("full-response routing, mutation gates, body files, and token secrecy remain visible", () => {
    for (
      const rule of [
        "stay read-only unless the user explicitly requests the exact",
        "verify the target identifier, team/project/workspace, command, flags, and body file",
        "provide a command draft instead of running it",
        "Run read commands with direct `bash`",
        "Never use `ctx_batch_execute`, `ctx_execute_file`, or `ctx_search`",
        "retrieve the explicit missing sections with the Linear CLI rather than Context Mode",
        "Do not pipe, redirect, summarize, filter, or bound the initial read",
        "Never print tokens.",
        "--description-file <description.md>",
        "--body-file <comment.md>",
      ]
    ) expect(skill).toContain(rule)
  })

  test("2.6.0 discovery exposes Markdown, document targets, and PR template flags", () => {
    expect(skill).toContain("Bundled command references match Linear CLI 2.6.0")
    expect(read("references/commands.md")).toContain(
      "[markdown](./markdown.md)",
    )
    expect(read("references/markdown.md")).toContain("+++ [title]")
    expect(read("references/markdown.md")).toContain(
      "stop and confirm before searching the whole",
    )
    expect(skill).toContain(
      "Mentions require a plain Linear URL, not `@name` or a Markdown link",
    )
    expect(skill).toContain(
      "`document create` requires exactly one attachment target",
    )
    for (
      const flag of [
        "--project",
        "--issue",
        "--initiative",
        "--team",
        "--cycle",
        "--release",
      ]
    ) {
      expect(read("references/document.md")).toContain(flag)
    }
    for (const flag of ["--template", "--no-template"]) {
      expect(read("references/issue.md")).toContain(flag)
    }
  })

  test("guard blocks require exact authorization and an unchanged bounded retry", () => {
    for (
      const rule of [
        "Hosted-service mutation blocked: Linear",
        "Do not load `references/issue.md` or other command references solely to diagnose",
        "exact `/authorize-hosted-mutation ...` command",
        "Ask the user whether to authorize and retry that exact blocked Linear mutation",
        "retry the unchanged blocked command within 10 minutes",
        "non-guard Linear error",
      ]
    ) expect(skill).toContain(rule)
  })
})
