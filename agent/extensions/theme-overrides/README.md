# theme-overrides

Auto-switch Pi's runtime theme between the local `dark` and `light` themes based on host system appearance.

This is a personal global Pi extension, so it intentionally has no external config file. Edit the TypeScript constants or the theme JSON files directly when changing behavior.

## What it does

- Automatically switches Pi to `dark` or `light` when your system theme changes.
- Uses the auto-discovered themes in `~/.pi/agent/themes/dark.json` and `~/.pi/agent/themes/light.json`.
- Applies runtime theme changes in memory only; it does **not** write `~/.pi/agent/settings.json`.
- Re-applies on startup and periodically checks for appearance changes.
- Backs off when you choose a custom Pi theme other than `dark` or `light`.

## Files

```text
~/.pi/agent/bin/pi
~/.pi/agent/extensions/theme-overrides/index.ts
~/.pi/agent/themes/dark.json
~/.pi/agent/themes/light.json
```

## Setup

This setup has two parts:

1. **Startup wrapper** fixes the first render and `pi --resume` by writing Pi's persisted theme before Pi starts.
2. **Runtime extension** keeps the active TUI theme synced after startup by polling system appearance.

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

The wrapper detects Windows light/dark mode and updates `~/.pi/agent/settings.json` to a managed theme before Pi starts, for example:

```json
{
  "theme": "dark"
}
```

This is intentional: explicit `"dark"` / `"light"` makes Pi load the correct theme immediately, before the TUI first renders.

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

Do not set a custom theme name if you want automatic switching. The wrapper and extension intentionally back off for non-managed theme names.

### 3. Runtime switching

If system appearance detection succeeds, the extension switches the active TUI theme after Pi starts. If detection fails, it leaves Pi's current/default theme alone.

## Fixed behavior

Runtime constants live in `constants.ts`:

| Constant           | Value  | Description                                               |
| ------------------ | ------ | --------------------------------------------------------- |
| `POLL_INTERVAL_MS` | `3000` | How often to re-check system appearance, in milliseconds. |
| `QUERY_TIMEOUT_MS` | `1500` | Timeout for each OS appearance command.                   |

## Appearance detection

The extension executes small local commands through Pi's extension API:

| Platform      | Probe                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| macOS         | `defaults read -g AppleInterfaceStyle`                                                                       |
| Linux         | `dbus-send` against `org.freedesktop.portal.Desktop` / `org.freedesktop.appearance color-scheme`             |
| Windows / WSL | trusted absolute `reg.exe` path querying `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize /v AppsUseLightTheme` |
| OrbStack      | `mac defaults read -g AppleInterfaceStyle`                                                                   |

## Troubleshooting

- **Theme does not change:** make sure Pi's selected theme is `dark` or `light`; the extension backs off for other theme names.
- **Linux does not switch:** ensure a DBus session and `xdg-desktop-portal` are available.
- **WSL does not switch:** ensure Windows' `reg.exe` is available at `/mnt/c/Windows/System32/reg.exe`.
- **Theme flickers or keeps changing:** make sure you are not loading another auto-theme extension at the same time.
