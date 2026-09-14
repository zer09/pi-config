import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import {
  startWindowsAppearanceWatcher,
  type WindowsAppearanceProcess,
} from "./windows-appearance-watcher.ts"
import type { ThemeKind } from "./types.ts"

class FakeAppearanceProcess extends EventEmitter {
  readonly stdout = new PassThrough()
  killCalls = 0

  kill(): boolean {
    this.killCalls += 1
    this.emit("exit", null, "SIGTERM")
    return true
  }
}

describe("Windows appearance watcher", () => {
  test("uses one persistent PowerShell process and emits parsed appearance changes", async () => {
    const child = new FakeAppearanceProcess()
    const appearances: ThemeKind[] = []
    const controller = new AbortController()
    let command = ""
    let args: readonly string[] = []
    let spawnCalls = 0

    const stop = startWindowsAppearanceWatcher({
      signal: controller.signal,
      pollIntervalMs: 3_000,
      onAppearance: (appearance) => appearances.push(appearance),
    }, (nextCommand, nextArgs) => {
      spawnCalls += 1
      command = nextCommand
      args = nextArgs
      return child as unknown as WindowsAppearanceProcess
    })

    expect(spawnCalls).toBe(1)
    expect(command.toLowerCase()).toContain("powershell.exe")
    const encodedIndex = args.indexOf("-EncodedCommand") + 1
    expect(encodedIndex).toBeGreaterThan(0)
    const script = Buffer.from(args[encodedIndex]!, "base64").toString("utf16le")
    expect(script).toContain("[Microsoft.Win32.Registry]::GetValue")
    expect(script).toContain("Start-Sleep -Milliseconds 3000")
    expect(script).not.toContain("reg.exe")

    child.stdout.write("ignored\nli")
    child.stdout.write("ght\r\ndark\n")
    await Promise.resolve()
    expect(appearances).toEqual(["light", "dark"])

    controller.abort()
    expect(child.killCalls).toBe(1)
    stop()
    expect(child.killCalls).toBe(1)
  })

  test("reports an unexpected watcher exit once", () => {
    const child = new FakeAppearanceProcess()
    const errors: string[] = []

    startWindowsAppearanceWatcher({
      signal: new AbortController().signal,
      pollIntervalMs: 3_000,
      onAppearance: () => undefined,
      onError: (error) => errors.push(error.message),
    }, () => child as unknown as WindowsAppearanceProcess)

    child.emit("exit", 7, null)
    child.emit("error", new Error("second failure"))
    expect(errors).toEqual(["Windows appearance watcher stopped unexpectedly (exit code 7)"])
  })
})
