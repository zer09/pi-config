# Firebase Local Environment Setup

Inspect existing project tools and configuration first. Dependency-only and existing-config tasks do not require CLI authentication, CLI download/install, project creation, app registration, or CLI initialization.

## 1. Verify Node.js only when needed
- **Action**: Run `node --version` only when the requested task needs Node.js.
- **Handling**: Match the repository's Node.js requirements. If Node.js is missing or incompatible, report it and ask before download/install. Follow the installation options below only after the user agrees:

  **Recommended: Use a Node Version Manager**
  This avoids permission issues when installing global packages.

  **For macOS or Linux:**
  1. Guide the user to the [official nvm repository](https://github.com/nvm-sh/nvm#installing-and-updating).
  2. Request the user to manually install `nvm` and reply when finished. **Stop and wait** for the user's confirmation.
  3. Make `nvm` available in the current terminal session by sourcing the appropriate profile:
     ```bash
     # For Bash
     source ~/.bash_profile
     source ~/.bashrc

     # For Zsh
     source ~/.zprofile
     source ~/.zshrc
     ```
  4. Install Node.js:
     ```bash
     nvm install 24
     nvm use 24
     ```

  **For Windows:**
  1. Guide the user to download and install [nvm-windows](https://github.com/coreybutler/nvm-windows/releases).
  2. Request the user to manually install `nvm-windows` and Node.js, and reply when finished. **Stop and wait** for the user's confirmation.
  3. After the user confirms, verify Node.js is available:
     ```bash
     node --version
     ```

  **Alternative: Official Installer**
  1. Guide the user to download and install the LTS version from [nodejs.org](https://nodejs.org/en/download).
  2. Request the user to manually install Node.js and reply when finished. **Stop and wait** for the user's confirmation.

## 2. Verify Firebase CLI only when needed
Use the installed or repository-pinned Firebase CLI. Resolve a pinned CLI through the repository's existing script or local binary; do not use a runner that downloads a package automatically. If the CLI is absent, report it and ask before download/install.

```bash
firebase --version
```

## 3. Optional CLI login and project selection
Login and active-project changes require user request or agreement. Inspect existing configuration first; use read-only CLI state checks only when needed for the task.

Only after the user requests or agrees to login, run:

```bash
firebase login
```

For an authorized login without local browser access, use `firebase login --no-localhost` instead. Keep local dependency and configuration work independent of login or optional agent tooling setup.
