# pi-config

`pi-config` is a starter repository for keeping Raspberry Pi configuration files, setup notes, and repeatable setup steps in one place.

Use this repo to document how a Raspberry Pi is configured, track useful scripts, and make future rebuilds or migrations easier.

## Goals

- Keep Raspberry Pi configuration documented and versioned.
- Store reusable setup, maintenance, and troubleshooting scripts.
- Make a fresh Raspberry Pi setup easier to reproduce.
- Avoid relying on undocumented manual changes.

## Suggested repository structure

```text
.
├── configs/        # System, service, and application configuration files
├── scripts/        # Setup, maintenance, and helper scripts
├── docs/           # Notes, runbooks, and troubleshooting guides
└── README.md       # Project overview and usage notes
```

The repository is intentionally lightweight. Add folders as the project grows.

## Getting started

Clone the repository:

```bash
git clone https://github.com/zer09/pi-config.git
cd pi-config
```

Create folders for configuration, scripts, or documentation as needed:

```bash
mkdir -p configs scripts docs
```

## Recommended workflow

1. Add configuration files or setup notes to this repo.
2. Document where each file should be installed on the Raspberry Pi.
3. Back up existing system files before replacing them.
4. Keep secrets, passwords, tokens, private keys, and Wi-Fi credentials out of Git.
5. Use example files such as `.env.example` when a configuration needs private values.

Before applying a system configuration, make a backup:

```bash
sudo cp /path/to/config /path/to/config.bak
```

Then copy the reviewed configuration into place:

```bash
sudo cp configs/example.conf /etc/example.conf
```

Restart the related service when required:

```bash
sudo systemctl restart example
```

Replace the example paths and service names with the real files used by this project.

## Security notes

Do not commit sensitive files such as:

- SSH private keys
- API tokens
- Passwords
- Wi-Fi credentials
- `.env` files with real values
- Machine-specific secrets

Consider adding a `.gitignore` file before storing generated files, logs, credentials, or local-only configuration.

## Documentation ideas

Useful notes to add over time:

- Raspberry Pi model and OS version
- Network and hostname setup
- Installed packages
- Enabled services
- Cron jobs or scheduled tasks
- Backup and restore steps
- Troubleshooting commands

## Contributing

When adding or changing configuration, include enough context for someone else to understand:

- What the file or script does
- Where it should be installed or run
- Any required dependencies
- How to verify that it worked

## License

No license has been specified yet. Add a license file if this repository will be shared or reused by others.
