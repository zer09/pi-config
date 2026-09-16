import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as childProcess from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import { join } from "node:path"
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent"

const originalAgentDir = process.env.PI_CODING_AGENT_DIR
const testAgentDir = mkdtempSync(join(os.tmpdir(), "theme-overrides-"))
process.env.PI_CODING_AGENT_DIR = testAgentDir
writeFileSync(join(testAgentDir, "settings.json"), JSON.stringify({ theme: "dark" }))
mock.module("@earendil-works/pi-coding-agent", () => ({ getAgentDir: () => testAgentDir }))

const [{ applyOverride }, { default: themeOverridesExtension }, { hasExplicitUseTheme }] = await Promise.all([
  import("./apply-override.ts"),
  import("./index.ts"),
  import("./theme-state.ts"),
])

afterAll(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir
  rmSync(testAgentDir, { force: true, recursive: true })
})

beforeEach(() => {
  spyOn(os, "release").mockReturnValue("6.6.0-microsoft-standard-WSL2")
})

afterEach(() => {
  mock.restore()
})

type Command = Parameters<ExtensionAPI["registerCommand"]>[1]

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function validLightResult(): { stdout: string; stderr: string; code: number; killed: boolean } {
  return {
    stdout: "AppsUseLightTheme REG_DWORD 0x1\nuint32 2\n",
    stderr: "",
    code: 0,
    killed: false,
  }
}

function makeContext(options?: {
  mode?: ExtensionContext["mode"]
  theme?: { name: string; sourcePath?: string }
  getTheme?: () => unknown
  notify?: (message: string, level: string) => void
  setTheme?: (theme: unknown) => void
}): ExtensionCommandContext {
  const ui = {
    theme: options?.theme ?? { name: "dark", sourcePath: undefined },
    getTheme: options?.getTheme ?? (() => ({ name: "light", sourcePath: undefined })),
    notify: options?.notify ?? (() => undefined),
    setTheme: options?.setTheme ?? (() => ({ success: true })),
  }

  return {
    mode: options?.mode ?? "tui",
    ui,
  } as unknown as ExtensionCommandContext
}

function makePi() {
  const commands = new Map<string, Command>()
  const registerCommand = mock((name: string, command: Command) => {
    commands.set(name, command)
  })
  const on = mock(() => undefined)
  const exec = mock(async (_command: string, _args: string[], _options?: { signal?: AbortSignal; timeout?: number }) => validLightResult())
  const pi = { registerCommand, on, exec } as unknown as ExtensionAPI
  return { pi, commands, registerCommand, on, exec }
}

describe("/theme-sync", () => {
  test("only registers the command, without startup hooks or background work", async () => {
    const { pi, commands, registerCommand, on, exec } = makePi()
    const runOverride = mock(async () => undefined)
    const interval = spyOn(globalThis, "setInterval")
    const timeout = spyOn(globalThis, "setTimeout")
    const spawn = spyOn(childProcess, "spawn")

    themeOverridesExtension(pi, runOverride)
    await Promise.resolve()

    expect(registerCommand).toHaveBeenCalledTimes(1)
    expect([...commands.keys()]).toEqual(["theme-sync"])
    expect(commands.get("theme-sync")?.description).toContain("once")
    expect(on).not.toHaveBeenCalled()
    expect(runOverride).not.toHaveBeenCalled()
    expect(exec).not.toHaveBeenCalled()
    expect(interval).not.toHaveBeenCalled()
    expect(timeout).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })

  test("awaits one WSL registry probe and applies the runtime theme without writing settings", async () => {
    const { pi, commands, exec } = makePi()
    const result = deferred<ReturnType<typeof validLightResult>>()
    exec.mockImplementation(() => result.promise)
    const selectedTheme = { name: "light", sourcePath: join(testAgentDir, "themes", "light.json") }
    const setTheme = mock(() => ({ success: true }))
    const ctx = makeContext({ getTheme: () => selectedTheme, setTheme })
    const settingsPath = join(testAgentDir, "settings.json")
    const before = { bytes: readFileSync(settingsPath), stat: statSync(settingsPath) }
    const interval = spyOn(globalThis, "setInterval")
    const timeout = spyOn(globalThis, "setTimeout")
    const spawn = spyOn(childProcess, "spawn")
    themeOverridesExtension(pi)
    let completed = false

    const syncing = commands.get("theme-sync")!.handler("", ctx).then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)
    expect(setTheme).not.toHaveBeenCalled()
    expect(exec).toHaveBeenCalledTimes(1)
    const [command, args, options] = exec.mock.calls[0]!
    expect(command).toMatch(/(^|\/)reg\.exe$/i)
    expect(args).toEqual([
      "Query", "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "/v", "AppsUseLightTheme",
    ])
    expect(options?.timeout).toBe(1_500)
    expect(options?.signal?.aborted).toBe(false)

    result.resolve(validLightResult())
    await syncing

    expect(completed).toBe(true)
    expect(exec).toHaveBeenCalledTimes(1)
    expect(setTheme).toHaveBeenCalledTimes(1)
    expect(setTheme).toHaveBeenCalledWith(selectedTheme)
    expect(interval).not.toHaveBeenCalled()
    expect(timeout).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    expect(readFileSync(settingsPath)).toEqual(before.bytes)
    const after = statSync(settingsPath)
    expect(after.mtimeMs).toBe(before.stat.mtimeMs)
    expect(after.mode).toBe(before.stat.mode)
    expect(after.ino).toBe(before.stat.ino)
  })

  test.each(["rpc", "json", "print"] as const)("does nothing in %s mode", async (mode) => {
    const { pi, commands, exec } = makePi()
    const runOverride = mock(async () => undefined)
    const notify = mock(() => undefined)
    themeOverridesExtension(pi, runOverride)

    await commands.get("theme-sync")!.handler("", makeContext({ mode, notify }))

    expect(runOverride).not.toHaveBeenCalled()
    expect(exec).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  test("leaves the theme alone when detection fails, without retrying", async () => {
    const { pi, commands, exec } = makePi()
    exec.mockRejectedValue(new Error("registry unavailable"))
    const setTheme = mock(() => ({ success: true }))
    const notify = mock(() => undefined)
    const interval = spyOn(globalThis, "setInterval")
    const timeout = spyOn(globalThis, "setTimeout")
    themeOverridesExtension(pi)

    await commands.get("theme-sync")!.handler("", makeContext({ setTheme, notify }))

    expect(exec).toHaveBeenCalledTimes(1)
    expect(setTheme).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(interval).not.toHaveBeenCalled()
    expect(timeout).not.toHaveBeenCalled()
  })

  test("contains and reports a failure on each manual invocation", async () => {
    const { pi, commands } = makePi()
    const notify = mock(() => undefined)
    const runOverride = mock(async () => {
      throw new Error("missing theme")
    })
    themeOverridesExtension(pi, runOverride)
    const ctx = makeContext({ notify })

    await expect(commands.get("theme-sync")!.handler("", ctx)).resolves.toBeUndefined()
    expect(runOverride).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith("Theme sync failed: missing theme", "warning")

    await expect(commands.get("theme-sync")!.handler("", ctx)).resolves.toBeUndefined()
    expect(runOverride).toHaveBeenCalledTimes(2)
    expect(notify).toHaveBeenCalledTimes(2)
  })

  test("contains notification failures instead of rejecting the command", async () => {
    const { pi, commands } = makePi()
    const warning = spyOn(console, "warn").mockImplementation(() => undefined)
    const error = new Error("missing theme")
    const notificationError = new Error("notification failed")
    const ctx = makeContext({
      notify: () => {
        throw notificationError
      },
    })
    themeOverridesExtension(pi, async () => {
      throw error
    })

    await expect(commands.get("theme-sync")!.handler("", ctx)).resolves.toBeUndefined()

    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning).toHaveBeenCalledWith("[theme-overrides] failed to report theme sync error", error, notificationError)
  })
})

describe("applyOverride", () => {
  test("backs off for a persisted non-managed theme", async () => {
    const { pi, exec } = makePi()
    const setTheme = mock(() => ({ success: true }))
    const settingsPath = join(testAgentDir, "settings.json")
    const originalSettings = readFileSync(settingsPath)
    try {
      writeFileSync(settingsPath, JSON.stringify({ theme: "custom" }))

      await applyOverride(pi, makeContext({ setTheme }), new AbortController().signal, () => true)

      expect(exec).not.toHaveBeenCalled()
      expect(setTheme).not.toHaveBeenCalled()
    } finally {
      writeFileSync(settingsPath, originalSettings)
    }
  })

  test("backs off for an active non-managed theme", async () => {
    const { pi, exec } = makePi()
    const setTheme = mock(() => ({ success: true }))
    const ctx = makeContext({ theme: { name: "custom" }, setTheme })

    await applyOverride(pi, ctx, new AbortController().signal, () => true)

    expect(exec).not.toHaveBeenCalled()
    expect(setTheme).not.toHaveBeenCalled()
  })

  test.each([undefined, join(testAgentDir, "themes", "light.json")])("skips an already-active theme with source %s", async (sourcePath) => {
    const { pi, exec } = makePi()
    const selectedTheme = { name: "light", sourcePath }
    const setTheme = mock(() => ({ success: true }))
    const ctx = makeContext({ theme: selectedTheme, getTheme: () => selectedTheme, setTheme })

    await applyOverride(pi, ctx, new AbortController().signal, () => true)

    expect(exec).toHaveBeenCalledTimes(1)
    expect(setTheme).not.toHaveBeenCalled()
  })

  test("distinguishes a user theme choice from the wrapper-injected default", () => {
    expect(hasExplicitUseTheme(["--use-theme", "light"], false)).toBe(true)
    expect(hasExplicitUseTheme(["--use-theme", "light"], true)).toBe(false)
    expect(hasExplicitUseTheme(["--name", "--use-theme", "hello"], false)).toBe(false)
    expect(hasExplicitUseTheme(["--", "--use-theme", "light"], false)).toBe(false)
  })

  test("does not undo an explicit per-run theme choice", async () => {
    const originalArgv = process.argv
    const originalMarker = process.env.PI_THEME_WRAPPER_INJECTED
    const setTheme = mock(() => ({ success: true }))
    const exec = mock(async () => validLightResult())
    try {
      process.argv = [originalArgv[0]!, originalArgv[1]!, "--use-theme", "dark"]
      delete process.env.PI_THEME_WRAPPER_INJECTED
      const controller = new AbortController()

      await applyOverride({ exec } as unknown as ExtensionAPI, makeContext({ setTheme }), controller.signal, () => true)

      expect(exec).toHaveBeenCalledTimes(0)
      expect(setTheme).toHaveBeenCalledTimes(0)
    } finally {
      process.argv = originalArgv
      if (originalMarker === undefined) delete process.env.PI_THEME_WRAPPER_INJECTED
      else process.env.PI_THEME_WRAPPER_INJECTED = originalMarker
    }
  })

  test("rechecks lifecycle state after the async probe before reading ctx", async () => {
    const result = deferred<ReturnType<typeof validLightResult>>()
    const execStarted = deferred<AbortSignal | undefined>()
    const controller = new AbortController()
    let active = true
    let stale = false
    let postStartUiReads = 0

    const ctx = {
      mode: "tui",
      get ui() {
        if (stale) {
          postStartUiReads += 1
          throw new Error("stale ctx")
        }
        return makeContext().ui
      },
    } as unknown as ExtensionContext
    const pi = {
      exec: mock((_command: string, _args: string[], options?: { signal?: AbortSignal }) => {
        execStarted.resolve(options?.signal)
        return result.promise
      }),
    } as unknown as ExtensionAPI

    const applying = applyOverride(pi, ctx, controller.signal, () => active)
    expect(await execStarted.promise).toBe(controller.signal)

    active = false
    stale = true
    controller.abort()
    result.resolve(validLightResult())

    await applying
    expect(postStartUiReads).toBe(0)
  })

  test("still applies the detected theme while the lifecycle is active", async () => {
    const selectedTheme = { name: "light", sourcePath: undefined }
    const setTheme = mock(() => ({ success: true }))
    const ctx = makeContext({ getTheme: () => selectedTheme, setTheme })
    const pi = {
      exec: mock(async () => validLightResult()),
    } as unknown as ExtensionAPI
    const controller = new AbortController()

    await applyOverride(pi, ctx, controller.signal, () => true)

    expect(setTheme).toHaveBeenCalledWith(selectedTheme)
  })
})
