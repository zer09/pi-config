---
name: notion-cli
description: "Use the Notion CLI (`ntn`) to work with Notion from the terminal: inspect CLI/API docs, authenticate with NOTION_API_TOKEN, call Notion API endpoints, query data sources or databases, create/read/update pages with Markdown, upload files, manage Notion workers, troubleshoot `ntn` setup, or perform any task involving `ntn`, Notion page IDs, database IDs, data-source IDs, file uploads, or Notion API automation."
---

# Notion CLI

Use `ntn` for Notion API and worker workflows. Treat Notion as a hosted service: stay read-only unless the user explicitly requests the exact create, update, delete, upload, deploy, execute, login, or logout action.

## Core rules

- Prefer `ntn`'s self-documentation over memory. Do not guess paths, flags, request fields, API versions, or response shapes.
- Use Pi Context Mode for read-only `ntn` commands that may exceed 20 lines, especially `ntn api ls`, `--docs`, `--spec`, page reads, JSON responses, and worker logs.
- Use code inside Context Mode to filter or summarize JSON output; print only the derived answer.
- Never print token values. Refer to `NOTION_API_TOKEN` by name only.
- Before a remote mutation, verify the target ID, parent, endpoint, method, and body. If the user did not request that exact mutation, provide the command draft instead of running it.
- Do not run internet install scripts for `ntn` unless the user explicitly asks and accepts the risk. If behavior matters, verify the installed CLI with `command -v ntn` and `ntn --version`.

## Discovery workflow

Run these before answering syntax-sensitive questions:

```bash
ntn --help
ntn <command> --help
ntn api ls
ntn api <path> --help
ntn api <path> --docs
ntn api <path> --spec
ntn doctor
```

Use `--docs` for official endpoint documentation and `--spec` for a reduced OpenAPI fragment. Use `ntn api ls` to discover supported endpoints instead of inventing paths.

## Authentication and environment

- Prefer an existing `NOTION_API_TOKEN` over `ntn login`.
- Check token presence without printing the value:

```bash
if [ -n "${NOTION_API_TOKEN:-}" ]; then echo "NOTION_API_TOKEN=set"; else echo "NOTION_API_TOKEN=unset"; fi
```

- Use `ntn login` or `ntn logout` only when the user explicitly asks or agrees, because it changes local auth state and may require a browser.
- Relevant environment variables include `NOTION_API_TOKEN`, `NOTION_API_VERSION`, `NOTION_API_BASE_URL`, `NOTION_ENV`, `NOTION_HOME`, `NOTION_KEYRING`, `NOTION_WORKSPACE_ID`, and `NOTION_WORKERS_CONFIG_FILE`. Verify current meanings with `ntn --help` or subcommand help.

## API calls

Start with endpoint help and schema:

```bash
ntn api v1/pages --help
ntn api v1/pages --docs
ntn api v1/pages --spec
```

Common call shapes:

```bash
# GET with query parameters
ntn api v1/users page_size==100

# POST with inline body fields
ntn api v1/pages parent[page_id]=abc123

# POST/PATCH/etc. with JSON body
ntn api v1/pages -d '{"parent":{"page_id":"abc123"}}'

# Override inferred method
ntn api v1/pages/<page-id> -X PATCH -d '{"properties":{}}'
```

`ntn api` defaults to GET and infers POST when stdin JSON, `--data`, or inline body inputs are present. Use `-X METHOD` when the method matters. For data sources, databases, properties, templates, comments, users, search, or advanced page fields, discover the exact endpoint and body with `ntn api ls`, `--help`, and `--spec`.

## Pages and Markdown

Prefer `ntn pages` for page content workflows:

```bash
ntn pages get <page-id>
ntn pages get <page-id> --json
ntn pages create --content '# Title\n\nBody'
ntn pages create --parent page:<parent-page-id> --content '## Heading\n\nBody'
ntn pages create --parent data-source:<data-source-id> < page.md
ntn pages update <page-id> --content '# Updated body'
ntn pages update <page-id> < page.md
```

Notes:

- `ntn pages get` prints Markdown with page properties as frontmatter by default.
- If output says Markdown was truncated or reports unknown block IDs, rerun with `--json` and inspect the unsupported blocks.
- Provide Markdown with `--content`, stdin, or the editor opened by `VISUAL` / `EDITOR` / `vi`.
- `--parent` accepts `page:<id>`, `database:<id>`, or `data-source:<id>` for create operations.
- Use `ntn api v1/pages` for properties, templates, or full Pages API behavior.

## Files

`ntn files` wraps Notion file uploads. Uploads are remote mutations, so require exact user intent.

```bash
ntn files create < file.png
ntn files create --filename photo.png --content-type image/png < /tmp/blob
ntn files create --external-url https://example.com/photo.png
ntn files get <upload-id>
ntn files list
```

Notes from local help: byte uploads read stdin as multipart; `--external-url` creates an external URL upload; `ntn files list` currently returns only the first page, so do not assume complete pagination unless help says otherwise.

## Workers

Use `ntn workers --help` and subcommand help before worker actions. Worker deploys and executions are remote mutations.

```bash
ntn workers new my-worker
ntn workers deploy
ntn workers ls
ntn workers exec <capability>
```

Before deploying or executing, inspect the current directory, worker config, target workspace/environment, and command help. Do not deploy, execute, or update workers unless the user explicitly requested that exact action.

## Safe Pi command patterns

For large or structured reads, keep raw output out of context:

```text
ctx_execute(language="shell", code="ntn api v1/pages/<id> --spec", intent="Notion pages endpoint schema")
ctx_execute(language="python", code="...process ntn JSON and print a compact summary...")
```

For user-facing command drafts, redact secrets and use placeholders such as `<page-id>`, `<data-source-id>`, `<database-id>`, `<upload-id>`, and `$NOTION_API_TOKEN`.

## Maintenance

Update this Local Skill using `docs/skills/notion-cli-update-process.md`. Preserve the local invariants in `docs/skills/local-skill-update-invariants.md`.
