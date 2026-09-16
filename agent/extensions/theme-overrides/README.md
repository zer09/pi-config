# theme-overrides

Select Pi's first-frame theme with the startup wrapper, then synchronize the runtime theme manually with `/theme-sync`.

This is a personal global Pi extension, so it intentionally has no external config file. Edit the TypeScript constants or the theme JSON files directly when changing behavior.

## What it does

- Synchronizes at exactly two points: once in the startup wrapper and once per manual `/theme-sync` invocation.
- Uses the auto-discovered themes in `~/.pi/agent/themes/dark.json` and `~/.pi/agent/themes/light.json`.
- Applies runtime theme changes in memory only; it does **not** write `~/.pi/agent/settings.json`.
- Keeps the extension dormant until `/theme-sync`: no session-start check, retries, timers, polling, watcher, or background process.
- Restricts manual synchronization to the TUI, respects explicit/non-managed theme choices, and skips an already-active theme.

## Files

```text
~/.pi/agent/bin/pi
~/.pi/agent/extensions/theme-overrides/index.ts
~/.pi/agent/themes/dark.json
~/.pi/agent/themes/light.json
```

## Setup

This setup has two parts:

1. **Startup wrapper** detects Windows appearance once and passes `--use-theme` before Pi starts, including for the first frame of `pi --resume`.
2. **Manual command** detects system appearance once when you run `/theme-sync` and immediately applies the matching runtime theme.

### 1. Install the startup wrapper

Create `~/.pi/agent/bin/pi` and make it executable:

```bash
mkdir -p "$HOME/.pi/agent/bin"
chmod +x "$HOME/.pi/agent/bin/pi"
```

The wrapper must run before the real Pi binary. Either put `~/.pi/agent/bin` before Bun in `PATH`:

```bash
export PATH="$HOME/.pi/agent/bin:$PATH"
```

or define a shell function, which is useful if another `pi()` function already exists:

```bash
PI_THEME_WRAPPER_BIN="$HOME/.pi/agent/bin/pi"
pi() {
  command "$PI_THEME_WRAPPER_BIN" "$@"
}
```

Verify resolution:

```bash
type -a pi
```

Expected output should include the wrapper before the Bun-installed Pi:

```text
pi is a function
pi is ~/.pi/agent/bin/pi
pi is ~/.bun/bin/pi
```

The wrapper detects Windows light/dark mode and prepends `--use-theme dark` or `--use-theme light` for an ordinary interactive run. Pi uses that theme for the first frame without saving it. The wrapper does not create, rewrite, rename, chmod, or otherwise touch `settings.json` during automatic startup.

A user-supplied `--use-theme` always wins. The wrapper preserves the original argv and does not inject a second selection. The runtime extension also detects that explicit choice and backs off, even when saved settings still name another managed theme.

Management commands (`auth`, `update`, `install`, `remove`, `uninstall`, `config`, and `list`), metadata flags, print/JSON/RPC modes, and exports bypass theme injection. The wrapper parses option values and the `--` delimiter so prompt text containing command words or flag-looking text does not cause a false bypass.

Escape hatch:

```bash
PI_THEME_WRAPPER_DISABLE=1 pi ...
```

### 2. Keep the managed theme names

The custom theme files must be named and declared as Pi's managed theme names:

```text
~/.pi/agent/themes/dark.json   # "name": "dark"
~/.pi/agent/themes/light.json  # "name": "light"
```

Use `dark` or `light` for manual synchronization. The extension backs off for persisted or active non-managed themes. The wrapper honors an explicit `--use-theme`; it does not inspect saved theme choices.

### 3. Manual runtime synchronization

After changing system appearance, run `/theme-sync` in the TUI. The command awaits the existing TypeScript `applyOverride` → `detectSystemAppearance` path. It does not invoke the startup wrapper.

If detection succeeds and the theme policy permits a change, the command applies the matching theme immediately. If detection fails or the matching theme is already active, the command leaves the theme alone. Apply failures produce a warning.

No automatic synchronization runs at session start, reload, resume, or later in the session. Launching `pi --resume` through the wrapper still selects the first-frame theme before Pi starts.

On Windows and WSL, this configuration follows Windows `AppsUseLightTheme`. Pi's native `light/dark` pair follows terminal color-scheme reports instead, and those two appearance sources can disagree. The wrapper marks only its injected first-frame default so manual synchronization remains allowed; an explicit user selection is never marked.

### WSL process safety

Each `/theme-sync` invocation uses one one-shot `reg.exe` query through Windows interop. The extension does not keep a PowerShell process or launch recurring Windows interop commands.

## Fixed behavior

Runtime constants live in `constants.ts`:

| Constant | Value | Description |
| --- | --- | --- |
| `QUERY_TIMEOUT_MS` | `1500` | Timeout in milliseconds for each manual one-shot appearance command. |

## Appearance detection

Only `/theme-sync` executes these one-shot local probes through Pi's extension API:

| Platform      | Probe                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| macOS         | `defaults read -g AppleInterfaceStyle`                                                                       |
| Linux         | `dbus-send` against `org.freedesktop.portal.Desktop` / `org.freedesktop.appearance color-scheme`             |
| Windows       | `reg.exe Query HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize /v AppsUseLightTheme` |
| WSL           | The same one-shot Windows `reg.exe` query through Windows interop                                            |
| OrbStack      | `mac defaults read -g AppleInterfaceStyle`                                                                   |

## Troubleshooting

- **Theme does not change:** run `/theme-sync`; system changes no longer trigger automatic runtime updates. Make sure the active and saved themes are managed, and no explicit `--use-theme` was supplied.
- **Linux does not switch:** ensure a DBus session and `xdg-desktop-portal` are available.
- **WSL does not switch:** ensure `reg.exe` is available at `/mnt/c/Windows/System32/reg.exe` or on PATH.
- **Theme changes without `/theme-sync`:** check for another auto-theme extension or Pi's terminal-following theme selection.
