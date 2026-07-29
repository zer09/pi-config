/**
 * Registers a minimal `@earendil-works/pi-tui` stub for tests.
 *
 * The Pi host supplies pi-tui at runtime, so it is not installed for this
 * extension. Import this module before any module that pulls in `render.ts`.
 */
import { mock } from "bun:test";

class Text {
  private value = "";

  constructor(value = "") {
    this.value = value;
  }

  setText(value: string): void {
    this.value = value;
  }

  render(): string[] {
    return this.value.split("\n");
  }
}

mock.module("@earendil-works/pi-tui", () => ({ Text }));
