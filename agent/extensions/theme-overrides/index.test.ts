import { afterAll, describe, expect, mock, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

const originalAgentDir = process.env.PI_CODING_AGENT_DIR
const testAgentDir = mkdtempSync(join(tmpdir(), "theme-overrides-"))
process.env.PI_CODING_AGENT_DIR = testAgentDir
writeFileSync(join(testAgentDir, "settings.json"), JSON.stringify({ theme: "dark" }))
mock.module("@earendil-works/pi-coding-agent", () => ({ getAgentDir: () => testAgentDir }))

const [{ applyOverride }, { default: themeOverridesExtension }] = await Promise.all([
  import("./apply-override.ts"),
  import("./index.ts"),
])

afterAll(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir
  rmSync(testAgentDir, { force: true, recursive: true })
})

type Handler = (event: unknown, ctx: ExtensionContext) => unknown

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
  getTheme?: () => unknown
  notify?: (message: string, level: string) => void
  setTheme?: (theme: unknown) => void
}): ExtensionContext {
  const ui = {
    theme: { name: "dark", sourcePath: undefined },
    getTheme: options?.getTheme ?? (() => ({ name: "light", sourcePath: undefined })),
    notify: options?.notify ?? (() => undefined),
    setTheme: options?.setTheme ?? (() => ({ success: true })),
  }

  return {
    mode: "tui",
    ui,
  } as unknown as ExtensionContext
}

async function flushDetachedWork(): Promise<void> {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("theme override lifecycle", () => {
  test("aborts an in-flight probe and never touches stale UI after shutdown", async () => {
    const handlers = new Map<string, Handler>()
    const execStarted = deferred<AbortSignal | undefined>()
    const result = deferred<ReturnType<typeof validLightResult>>()
    let stale = false
    let staleUiReads = 0

    const ctx = {
      mode: "tui",
      get ui() {
        if (stale) {
          staleUiReads += 1
          throw new Error("stale ctx")
        }
        return makeContext().ui
      },
    } as unknown as ExtensionContext

    const pi = {
      on(event: string, handler: Handler) {
        handlers.set(event, handler)
      },
      exec: mock((_command: string, _args: string[], options?: { signal?: AbortSignal }) => {
        execStarted.resolve(options?.signal)
        return result.promise
      }),
    } as unknown as ExtensionAPI

    themeOverridesExtension(pi)

    handlers.get("session_start")?.({ type: "session_start" }, ctx)
    const signal = await execStarted.promise
    expect(signal?.aborted).toBe(false)

    handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx)
    stale = true
    expect(signal?.aborted).toBe(true)

    result.resolve(validLightResult())
    await flushDetachedWork()
    expect(staleUiReads).toBe(0)
  })

  test("reports an active failure once", async () => {
    const handlers = new Map<string, Handler>()
    const notifications: string[] = []
    const ctx = makeContext({ notify: (message) => notifications.push(message) })
    const pi = {
      on(event: string, handler: Handler) {
        handlers.set(event, handler)
      },
    } as unknown as ExtensionAPI

    themeOverridesExtension(pi, async () => {
      throw new Error("missing theme")
    })

    handlers.get("session_start")?.({ type: "session_start" }, ctx)
    await flushDetachedWork()
    handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx)

    expect(notifications).toEqual(["Theme override failed: missing theme"])
  })

  test("contains notification failures instead of rejecting detached work", async () => {
    const handlers = new Map<string, Handler>()
    const warning = spyOn(console, "warn").mockImplementation(() => undefined)
    const ctx = makeContext({
      notify: () => {
        throw new Error("notification failed")
      },
    })
    const pi = {
      on(event: string, handler: Handler) {
        handlers.set(event, handler)
      },
    } as unknown as ExtensionAPI

    themeOverridesExtension(pi, async () => {
      throw new Error("missing theme")
    })

    handlers.get("session_start")?.({ type: "session_start" }, ctx)
    await flushDetachedWork()
    handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx)

    expect(warning).toHaveBeenCalledTimes(1)
    warning.mockRestore()
  })
})

describe("applyOverride", () => {
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
