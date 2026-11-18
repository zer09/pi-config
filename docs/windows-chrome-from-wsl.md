# Use Windows Chrome from Pi in WSL

Pi stays in WSL2. The **Chrome for Pi** shortcut starts Windows Chrome with a separate profile. The browser harness reaches its debugging port at `127.0.0.1:9223` without exposing the port to the network.

## Everyday use

1. Open **Chrome for Pi** on Windows and start `pi` in WSL, in either order. Keep Linux Chromium closed: `BU_CDP_PORTS=9223` adds port `9223` to discovery; it does not exclude the default port `9222` or a local browser.
2. For each browser task, run `/browser-setup` yourself. Check that its GitHub test tab opens in **Chrome for Pi** and tell the agent setup succeeded. If Pi offers to open Linux Chromium, decline. Repeat setup and confirmation after a disconnect, as required by the [local browser skill](../agent/skills/pi-browser-harness/SKILL.md).
3. Sign in manually if needed. The separate profile does not inherit your everyday logins. Quit **Chrome for Pi** when you no longer need browser access.

Optional: `/browser-background on` asks the harness to keep Chrome in the background where possible. It affects window focus, not which browser Pi uses or how much memory Chrome uses.

## Recreate the setup

**Windows networking.** On Windows 11 22H2 or newer, edit `%USERPROFILE%\.wslconfig`. Add `networkingMode=mirrored` under the existing `[wsl2]` section. Preserve other settings, including `swap=0` on this machine. This lets WSL reach Windows services through `127.0.0.1` ([Microsoft documentation](https://learn.microsoft.com/en-us/windows/wsl/networking#mirrored-mode-networking)).

**WSL launcher.** Keep the existing theme wrapper and pass `BU_CDP_PORTS` only to Pi. The configured block starts at `~/.bashrc:202` on this machine:

```bash
PI_THEME_WRAPPER_BIN="$HOME/.pi/agent/bin/pi"
pi() {
  BU_CDP_PORTS=9223 command "$PI_THEME_WRAPPER_BIN" "$@"
}
```

Save work in **all** WSL distributions before applying the networking change. In Windows PowerShell, run `wsl --shutdown`. Reopen WSL and run `wslinfo --networking-mode`; it should print `mirrored`. This restart is for the configuration change, not for everyday use.

**Windows shortcut.** Run the following in Windows PowerShell to **print** the shortcut target with both paths expanded:

```powershell
'"{0}\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9223 --user-data-dir="{1}\PiBrowserHarness"' -f $env:ProgramFiles, $env:LOCALAPPDATA
```

On the Windows Desktop, choose **New > Shortcut**, paste the printed line as the location, and name it **Chrome for Pi**. If you already have `%TEMP%\Chrome for Pi.lnk`, you can copy it to the Desktop in File Explorer instead.

The port flag enables remote debugging; you do not need to toggle `chrome://inspect/#remote-debugging` in everyday Chrome. [Chrome 136 and newer](https://developer.chrome.com/blog/remote-debugging-port) require a non-default data directory for this flag. Keep the debugging port on localhost: anyone who can reach it can control the dedicated browser and act as accounts signed into it.

## If setup cannot find Windows Chrome

With the shortcut open, run this yourself in WSL. It prints the browser's user agent without printing its debugging URL:

```bash
curl --noproxy '*' -fsS --max-time 5 http://127.0.0.1:9223/json/version | jq -r '.["User-Agent"]'
```

Look for `Windows NT`. If the connection fails, check mirrored networking and the shortcut's **Properties > Target**. If it reports Linux, quit Linux Chromium and retry. This fixed-port setup does not need `BU_CDP_WS`, the override for one specific browser instance. See the [harness connection guide](https://github.com/amankumarsingh77/pi-browser-harness/blob/v0.19.1/README.md#browser-on-another-machine).

Keep the host configuration files, binary shortcut, browser data and local profile selection (`agent/browser-harness.json`) out of this repository. The guide is the reproducible part.
