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
~/.pi/agent/extensions/theme-overrides/index.ts
~/.pi/agent/themes/dark.json
~/.pi/agent/themes/light.json
```

Pi should keep `settings.json` set to the startup/default theme, currently:

```json
{
  "theme": "light"
}
```

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
| Windows / WSL | `reg.exe Query HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize /v AppsUseLightTheme` |
| OrbStack      | `mac defaults read -g AppleInterfaceStyle`                                                                   |

## Troubleshooting

- **Theme does not change:** make sure Pi's selected theme is `dark` or `light`; the extension backs off for other theme names.
- **Linux does not switch:** ensure a DBus session and `xdg-desktop-portal` are available.
- **WSL does not switch:** ensure Windows' `reg.exe` is available at `/mnt/c/Windows/System32/reg.exe` or on PATH.
- **Theme flickers or keeps changing:** make sure you are not loading another auto-theme extension at the same time.
