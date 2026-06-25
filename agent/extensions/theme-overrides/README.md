# theme-overrides

Auto-switch Pi's dark/light theme based on your system theme for the [Pi coding agent](https://pi.dev).

This built-in global Pi extension watches your host system appearance and automatically switches Pi between the matching `dark` and `light` runtime themes. The bundled palettes intentionally match Pi's default themes; provide user config when you want to override either palette.

## What it does

- Automatically switches Pi to `dark` or `light` when your system theme changes.
- Applies Pi's default `dark` / `light` palettes by default.
- Lets you override either palette with user-provided theme JSON.
- Detects system appearance on macOS, Linux, Windows, WSL, and OrbStack.
- Re-applies on startup and periodically checks for appearance changes.
- Backs off when you choose a custom Pi theme other than its managed `resume-light` helper theme.

## Location

This extension is auto-discovered from:

```text
~/.pi/agent/extensions/theme-overrides/index.ts
```

The companion pre-session light theme is loaded from:

```text
~/.pi/agent/themes/resume-light.json
```

## Configuration

Configuration is optional. To start from the bundled defaults, copy `config.default.json` to your user config path:

```bash
mkdir -p ~/.pi/agent/theme-overrides
cp ~/.pi/agent/extensions/theme-overrides/config.default.json ~/.pi/agent/theme-overrides/config.json
```

If you are working from a local checkout or unpacked package, run the same copy from the package directory:

```bash
mkdir -p ~/.pi/agent/theme-overrides
cp config.default.json ~/.pi/agent/theme-overrides/config.json
```

The user config path is:

```text
~/.pi/agent/theme-overrides/config.json
```

You can also point at an explicit config file:

```bash
PI_THEME_OVERRIDES_CONFIG=/path/to/config.json pi
```

Example user config:

```json
{
  "enabled": true,
  "fallbackTheme": "dark",
  "pollIntervalMs": 3000,
  "queryTimeoutMs": 1500,
  "themes": {
    "dark": "/absolute/path/to/dark.json",
    "light": "/absolute/path/to/light.json"
  }
}
```

Relative theme paths in `~/.pi/agent/theme-overrides/config.json` are resolved relative to `~/.pi/agent/theme-overrides/`. Relative theme paths in `PI_THEME_OVERRIDES_CONFIG` are resolved relative to that config file's directory. Bundled defaults resolve relative to this package directory.

If no user config exists, the bundled palettes under `themes/` are used. These bundled palettes are copies of Pi's default `dark` and `light` themes.

## Options

| Option           | Default               | Description                                               |
| ---------------- | --------------------- | --------------------------------------------------------- |
| `enabled`        | `true`                | Enables automatic theme overriding.                       |
| `fallbackTheme`  | `dark`                | Theme used when system appearance detection fails.        |
| `pollIntervalMs` | `3000`                | How often to re-check system appearance, in milliseconds. |
| `queryTimeoutMs` | `1500`                | Timeout for each OS appearance command.                   |
| `themes.dark`    | `./themes/dark.json`  | Dark palette path.                                        |
| `themes.light`   | `./themes/light.json` | Light palette path.                                       |

## Appearance detection

The extension executes small local commands through Pi's extension API:

| Platform      | Probe                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| macOS         | `defaults read -g AppleInterfaceStyle`                                                                       |
| Linux         | `dbus-send` against `org.freedesktop.portal.Desktop` / `org.freedesktop.appearance color-scheme`             |
| Windows / WSL | `reg.exe Query HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize /v AppsUseLightTheme` |
| OrbStack      | `mac defaults read -g AppleInterfaceStyle`                                                                   |

If a probe fails, times out, or is unsupported, the extension uses `fallbackTheme`.

## Security

Pi extensions run with your local user permissions. This extension reads local JSON files and runs the appearance-detection commands listed above.

## Troubleshooting

- **Theme does not change:** make sure Pi's selected theme is `dark`, `light`, or `resume-light`. The extension intentionally backs off for other theme names.
- **Linux always falls back:** ensure a DBus session and `xdg-desktop-portal` are available.
- **WSL always falls back:** ensure Windows' `reg.exe` is available at `/mnt/c/Windows/System32/reg.exe` or on PATH.
- **Theme flickers or keeps changing:** make sure you are not loading both this built-in copy and another package/development copy at the same time.
