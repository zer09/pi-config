# Gemini Notebook (formerly Google NotebookLM) CLI - Command Reference

Runtime command guidance for `nlm 0.13.0`. Use installed command help for options not listed here.

Apply the [root authorization rules](../SKILL.md#safety-and-authorization) before executing examples. Reads do not authorize writes. Setup, auth recovery, exports, uploads, and configuration each retain their own scope; delete always needs explicit target confirmation. Batch and pipeline generation must not bypass Studio confirmation.

## Table of Contents

1. [Global Options](#global-options)
2. [Authentication](#authentication)
3. [Plan Usage](#plan-usage)
4. [Notebook Commands](#notebook-commands)
5. [Source Commands](#source-commands)
6. [Research Commands](#research-commands)
7. [Generation Commands](#generation-commands)
8. [Studio Commands](#studio-commands)
9. [Download Commands](#download-commands)
10. [Export Commands](#export-commands)
11. [Sharing Commands](#sharing-commands)
12. [Note Commands](#note-commands)
13. [Chat Commands](#chat-commands)
14. [Alias Commands](#alias-commands)
15. [Config Commands](#config-commands)
16. [Organization and Automation](#organization-and-automation)
17. [Setup, Skill, and Diagnostics](#setup-skill-and-diagnostics)

---

## Global Options

```bash
nlm --version, -v      # Show version and exit
nlm --ai               # Output AI-friendly documentation
nlm --install-completion  # Install shell completion
nlm --show-completion  # Show completion script
nlm --help             # Show help and exit
```

---

## Authentication

### nlm login

Authenticate with Gemini Notebook using the managed browser auth flow.

```bash
nlm login [OPTIONS]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--profile` | `-p` | Profile name for multiple accounts |
| `--check` | | Validate current credentials without re-authenticating |
| `--provider` | | Auth provider: `builtin` (default) or `openclaw` |
| `--cdp-url` | | CDP endpoint URL for external provider mode (default: `http://127.0.0.1:18800`) |
| `--manual` | `-m` | Import cookies from file |
| `--file` | `-f` | Cookie file path for manual mode |
| `--force` | | Replace credentials even if the detected account differs |
| `--clear` | | Clear stored browser/profile state before login |
| `--wsl` | | Use the WSL/Windows-browser authentication path |

**Note**: Each profile gets its own isolated Chrome session, so you can be logged into multiple Google accounts simultaneously.

### nlm login profile list

List all authentication profiles with their associated email addresses.

```bash
nlm login profile list
```

### nlm login profile delete

Delete an authentication profile and its credentials.

```bash
nlm login profile delete <profile>
```

### nlm login profile rename

Rename an authentication profile.

```bash
nlm login profile rename <old-name> <new-name>
```

### nlm login switch

Switch the default profile for all commands.

```bash
nlm login switch <profile>
```

| Argument | Description |
|----------|-------------|
| `<profile>` | Profile name to switch to |

**Example:**
```bash
nlm login switch work
# Output: ✓ Switched default profile to work
#         Account: user@example.com
```

### nlm auth refresh

```bash
nlm auth refresh [--profile <profile>]
```

Runs a non-interactive headless-browser refresh against a saved profile and writes renewed credentials. It exits non-zero on failure. This is auth recovery, not an offline status check. Use only for authorized recovery or expressly requested unattended maintenance; do not install a scheduler as an adjacent step. `NOTEBOOKLM_COOKIES` or `NOTEBOOKLM_DISABLE_HEADLESS_REFRESH=1` prevents this refresh. Never print secret values or unset those controls automatically.

---

## Plan Usage

```bash
nlm usage
nlm usage --json
nlm usage --profile <profile>
```

This account-level read reports measured compute usage, not estimated request counts. Inspect both `rolling` and `weekly` windows: `percent_used`, `percent_remaining`, and `resets_at`. JSON timestamps are UTC; table timestamps use local time. `tier` appears when available. Check usage before quota-limited work when the remaining budget matters.

MCP `usage_get(profile="<profile>")` checks one saved account without switching the default used by other tools. An explicit profile takes precedence over environment cookies; a missing profile errors rather than falling back. Auth failure does not mean exhausted quota and does not authorize account switching or automatic login.

---

## Notebook Commands

### nlm notebook list

List all notebooks.

```bash
nlm notebook list [OPTIONS]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--json` | | Output as JSON |
| `--quiet` | `-q` | Output IDs only |
| `--title` | | Output as "ID: Title" |
| `--full` | | Show all columns |
| `--profile` | `-p` | Use specific profile |

### nlm notebook create

Create a new notebook.

```bash
nlm notebook create <title> [OPTIONS]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--json` | `-j` | Output stable machine-readable result |
| `--profile` | `-p` | Use specific profile |

### nlm notebook get

Get notebook details.

```bash
nlm notebook get <notebook-id> [OPTIONS]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--profile` | `-p` | Use specific profile |

### nlm notebook describe

Get AI-generated notebook summary with suggested topics.

```bash
nlm notebook describe <notebook-id> [OPTIONS]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--profile` | `-p` | Use specific profile |

### nlm notebook query

Ask a question about notebook sources.

```bash
nlm notebook query <notebook-id> <question> [OPTIONS]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--source-ids` | | Limit to specific sources (comma-separated) |
| `--conversation-id` | `-c` | Continue a specified conversation |
| `--new-conversation` | | Start an independent chat instead of continuing persistent history |
| `--timeout` | `-t` | Query time budget in seconds (default: 120) |
| `--json` | `-j` | Output as JSON |
| `--profile` | `-p` | Use specific profile |

MCP also supports `notebook_query_start` followed by `notebook_query_status(query_id)` for long queries. Poll only the requested query; do not start duplicates after a timeout without checking its status.

### nlm notebook rename

Rename a notebook.

```bash
nlm notebook rename <notebook-id> <new-title> [OPTIONS]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--profile` | `-p` | Use specific profile |

### nlm notebook delete

Delete a notebook permanently.

```bash
nlm notebook delete <notebook-id> [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--confirm` | **Required** to confirm deletion |
| `--profile` | Use specific profile |

---

## Source Commands

### nlm source list

List sources in a notebook.

```bash
nlm source list <notebook-id> [OPTIONS]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--json` | | Output as JSON |
| `--quiet` | `-q` | Output IDs only |
| `--url` | | Output as "ID: URL" |
| `--full` | | Show all columns (wider URL display) |
| `--drive` | | Show Drive sources with freshness status |
| `--skip-freshness` | `-S` | Skip freshness checks (faster with --drive) |
| `--profile` | `-p` | Use specific profile |

When freshness is skipped, `stale`/`is_stale` is `null` (unknown), not
`false` (fresh).

### nlm source add

Add a source to a notebook.

```bash
nlm source add <notebook-id> [OPTIONS]
```

**URL Source:**
| Option | Description |
|--------|-------------|
| `--url` | URL to add; repeat for bulk URL add |
| `--youtube` | Explicit YouTube URL |

**Text Source:**
| Option | Description |
|--------|-------------|
| `--text` | Text content to add |
| `--title` | Title for text source |

**Drive Source:**
| Option | Description |
|--------|-------------|
| `--drive` | Google Drive document ID |
| `--type` | Drive doc type: `doc`, `slides`, `sheets`, `pdf` |
| `--title` | Display title |

**File Source:**
| Option | Description |
|--------|-------------|
| `--file` | Local path on the machine running `nlm` |
| `--wait` | Wait until Gemini Notebook finishes processing |
| `--wait-timeout` | Processing timeout in seconds |

| Option | Short | Description |
|--------|-------|-------------|
| `--profile` | `-p` | Use specific profile |

### nlm source get

Get source metadata.

```bash
nlm source get <source-id> [OPTIONS]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--profile` | `-p` | Use specific profile |

### nlm source describe

Get AI-generated source summary with keywords.

```bash
nlm source describe <source-id> [OPTIONS]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--profile` | `-p` | Use specific profile |

### nlm source content

Get raw text content of a source.

```bash
nlm source content <source-id> [OPTIONS]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--output` | `-o` | Export to file path |
| `--profile` | `-p` | Use specific profile |

### nlm source stale

List stale (outdated) Drive sources.

```bash
nlm source stale <notebook-id> [OPTIONS]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--profile` | `-p` | Use specific profile |

### nlm source sync

Sync Drive sources with latest content.

```bash
nlm source sync <notebook-id> [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--confirm` | **Required** to execute sync |
| `--source-ids` | Specific source IDs to sync (comma-separated) |
| `--profile` | Use specific profile |

### nlm source rename

Rename a source.

```bash
nlm source rename <source-id> <new-title> [OPTIONS]
nlm rename source <source-id> <new-title> [OPTIONS]  # verb-first alias
```

| Option | Description |
|--------|-------------|
| `--notebook` | **Required** - Notebook ID containing the source |
| `--profile` | Use specific profile |

### nlm source delete

Delete a source permanently.

```bash
nlm source delete <source-id> [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--confirm` | **Required** to confirm deletion |
| `--profile` | Use specific profile |

---

## Research Commands

### nlm research start

Start a research task to discover new sources.

```bash
nlm research start <query> [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--notebook-id` | Existing target notebook ID |
| `--title` | Create a new destination notebook with this title |
| `--mode` | `fast` (default, ~30s) or `deep` (~5min, web only) |
| `--source` | `web` (default) or `drive` |
| `--force` | Override pending research |
| `--auto-import` | Poll every 30 seconds for up to 900 seconds, then import completed results (alias: `--wait-and-import`) |
| `--profile` | Use specific profile |

### nlm research status

Check research task progress.

```bash
nlm research status <notebook-id> [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--task-id` | Check specific task (auto-detected if omitted) |
| `--max-wait` | Max seconds to wait (default: 300, 0=single check) |
| `--full` | Show full details |
| `--profile` | Use specific profile |

### nlm research import

Import discovered sources into notebook.

```bash
nlm research import <notebook-id> <task-id> [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--indices` | Comma-separated indices of sources to import (default: all) |
| `--cited-only` | Import only sources cited by the research report (overrides `--indices`) |
| `--timeout` | Import timeout in seconds (default: 300) |
| `--profile` | Use specific profile |

---

## Generation Commands

All generation commands share `--confirm`, `--source-ids`, and `--profile`.
The `--language` option is available for audio, report, slides, infographic,
video, and data-table.

| Option | Short | Description |
|--------|-------|-------------|
| `--confirm` | `-y` | **Required** to execute generation |
| `--source-ids` | | Limit to specific sources (comma-separated) |
| `--language` | | BCP-47 language code where supported, including regional locales such as `es-419` |
| `--profile` | `-p` | Use specific profile |

### nlm audio create

Generate audio overview (podcast).

```bash
nlm audio create <notebook-id> [OPTIONS]
```

| Option | Values | Default |
|--------|--------|---------|
| `--format` | `deep_dive`, `brief`, `critique`, `debate` | `deep_dive` |
| `--length` | `short`, `default`, `long` | `default` |
| `--focus` | Focus text/topic | |

For audio, regional locales can affect the voice accent. Gemini Notebook has been
observed using `es`/`es-ES` for Spain Spanish and `es-US`/`es-419` for
Latin-American Spanish. `NOTEBOOKLM_HL` can set the regional default.

### nlm report create

Generate written report.

```bash
nlm report create <notebook-id> [OPTIONS]
```

| Option | Values | Default |
|--------|--------|---------|
| `--format` | `"Briefing Doc"`, `"Study Guide"`, `"Blog Post"`, `"Create Your Own"`, `"Interactive"` | `"Briefing Doc"` |
| `--template` | Interactive report template (only for `Interactive`) | `learning_overview` |
| `--prompt` | Custom prompt (required for "Create Your Own") | |

### Interactive report content and elements

```bash
nlm report get <notebook-id> <report-id> [--json] [-o report.md]
nlm report elements <notebook-id> <report-id> [--json] [--content]
nlm report elements <notebook-id> <report-id> --wait <element-id> --timeout 180 --content
nlm report element create <notebook-id> <report-id> --id <element-id> --confirm
nlm report element create <notebook-id> <report-id> --type video --setting video_format=explainer --confirm
nlm report element create-batch <notebook-id> <report-id> --plan plan.json --confirm
```

`get` reads report markdown; `-o` is a separate local export. `elements` reads suggested cards, sections, allowed settings, and status. `--wait` accepts comma-separated element IDs and `--timeout` bounds waiting. `--content` includes supported inline content.

`element create` selects by `--id` or `--type`; options include `--prompt`, `--language`, repeatable `--setting name=value`, `--json`, and `--profile`. `create-batch` takes a JSON list of `element_id`, optional `steering_prompt`, and optional `settings`. Report creation does not authorize generating its suggested elements. Each requested generation still needs `--confirm`.

MCP `report(action="get"|"elements"|"generate", notebook_id=..., artifact_id=...)` provides the same surface. `generate` with `plan=[...]` and no confirmation validates without generating; only an authorized plan may use `confirm=True`. `elements` accepts `wait_for=[...]`, `timeout`, and `include_content=True`. A timed-out poll is not a failed generation. See the [interactive report workflow](workflows.md#interactive-report-elements).

### nlm quiz create

Generate quiz questions.

```bash
nlm quiz create <notebook-id> [OPTIONS]
```

| Option | Values | Default |
|--------|--------|---------|
| `--count` | Number of questions | 2 |
| `--difficulty` | 1-5 (1=easy, 5=hard) | 2 |
| `--focus` | Focus text/topic | |

### nlm flashcards create

Generate flashcards.

```bash
nlm flashcards create <notebook-id> [OPTIONS]
```

| Option | Values | Default |
|--------|--------|---------|
| `--difficulty` | `easy`, `medium`, `hard` | `medium` |
| `--focus` | Focus text/topic | |

### nlm mindmap create

Generate mind map.

```bash
nlm mindmap create <notebook-id> [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--title` | Display title for the mind map |

List mind maps through `nlm studio status <notebook-id>`.

### nlm slides create

Generate slide deck.

```bash
nlm slides create <notebook-id> [OPTIONS]
```

| Option | Values | Default |
|--------|--------|---------|
| `--format` | `detailed_deck`, `presenter_slides` | `detailed_deck` |
| `--length` | `short`, `default` | `default` |
| `--focus` | Focus text/topic | |

### nlm slides revise

Revise one or more slides and create a new deck.

```bash
nlm slides revise <artifact-id> --slide "1 Make the title larger" --confirm
```

`--slide` is repeatable and uses `"<1-based slide number> <instruction>"`.
The original deck is unchanged.

### nlm infographic create

Generate infographic.

```bash
nlm infographic create <notebook-id> [OPTIONS]
```

| Option | Values | Default |
|--------|--------|---------|
| `--orientation` | `landscape`, `portrait`, `square` | `landscape` |
| `--detail` | `concise`, `standard`, `detailed` | `standard` |
| `--style` | `auto_select`, `sketch_note`, `professional`, `bento_grid`, `editorial`, `instructional`, `bricks`, `clay`, `anime`, `kawaii`, `scientific` | `auto_select` |
| `--focus` | Focus text/topic | |

### nlm video create

Generate video overview.

```bash
nlm video create <notebook-id> [OPTIONS]
```

| Option | Values | Default |
|--------|--------|---------|
| `--format` | `explainer`, `brief`, `cinematic`, `short` | `explainer` |
| `--style` | `auto_select`, `custom`, `classic`, `whiteboard`, `kawaii`, `anime`, `watercolor`, `retro_print`, `heritage`, `paper_craft` (not for cinematic/short) | `auto_select` |
| `--style-prompt` | Custom visual style text (requires `--style custom`, or implies it when `--style` omitted) | |
| `--focus` | Focus text/topic | |

`short` produces a ~60s vertical video with no visual style picker. Non-English
output is best-effort: `--language` adds an explicit language requirement to the
focus prompt because the captured Short RPC uses a null language slot.

List generated videos with `nlm video list <notebook-id>`.

### nlm data-table create

Extract structured data as a table.

```bash
nlm data-table create <notebook-id> <description> [OPTIONS]
```

**Note**: `<description>` is a **required positional argument** describing what data to extract.

---

## Studio Commands

### nlm studio status

List all generated artifacts in a notebook.

```bash
nlm studio status <notebook-id> [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |
| `--full` | Show all details |
| `--artifact-id` | Return one artifact by ID |
| `--limit` | Maximum artifacts to return (1-100) |
| `--offset` | Skip artifacts for pagination |
| `--mcp-compatible` | Return the lean, paginated MCP envelope as JSON |
| `--profile` | Use specific profile |

`--json --full` includes `source_ids`, allowing each artifact to be traced to
the source set used to generate it.

The legacy `--json` shape remains a plain list and now contains both `id` and
`artifact_id`. MCP-compatible output defaults to 20 lean artifacts; combine it
with `--full` only when prompts or other rich fields are needed.

### nlm studio delete

Delete a generated artifact.

```bash
nlm studio delete <notebook-id> <artifact-id> [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--confirm` | **Required** to confirm deletion |
| `--profile` | Use specific profile |
---

## Download Commands

### nlm download

Download generated artifacts to local files.

```bash
nlm download <type> <notebook-id> [OPTIONS]
```

**Available types:** `audio`, `video`, `report`, `mind-map`, `slide-deck`,
`infographic`, `quiz`, `flashcards`, `data-table`, `file`

| Option | Description |
|--------|-------------|
| `--id` | Specific artifact ID (uses latest if omitted) |
| `--format` | Output format for quiz/flashcards: `json`, `markdown`, `html` |
| `--output` | Output file path |

**Examples:**
```bash
nlm download audio <nb-id> --output podcast.m4a
nlm download video <nb-id> --output video.mp4
nlm download report <nb-id> --output report.md
nlm download file <nb-id> --id <artifact-id> --output export.bin
nlm download quiz <nb-id> --output quiz.html --format html
nlm download flashcards <nb-id> --output cards.json --format json
```

Audio downloads contain AAC in MP4 and require `.m4a` or `.mp4`; `.mp3` is rejected. Conversion is a separate local operation, not part of a download request.

MCP downloads stay inside the download root on the server host. The root uses `NOTEBOOKLM_DOWNLOAD_DIR` after stripping whitespace and expanding `~` if the value is nonempty. Otherwise, it uses `~/Downloads/gemini-notebook` only if `~/Downloads` is an existing directory; if not, it uses the application storage directory's `downloads` subdirectory.

Relative `output_path` values are anchored to this root; outside paths are refused. Use the returned absolute destination. CLI can use an explicitly requested outside path only when `NOTEBOOKLM_DOWNLOAD_DIR` is unset or empty. A nonempty value confines CLI too; unlike the MCP resolver, CLI does not strip whitespace. Never derive output paths from notebook content or unset confinement to bypass it.

For newly completed audio/video, MCP `download_artifact(..., artifact_id=..., wait=True, wait_timeout=300)` can wait for CDN readiness. The wait bounds service polling, not total transfer time. Retry a late download rather than generating again. Downloads and hosted Google Docs/Sheets exports are different authorized actions.

### nlm download all

Download every completed artifact of a notebook — or every notebook — into
per-notebook directories named after each notebook's title.

```bash
nlm download all <notebook-id> [OPTIONS]
nlm download all --all-notebooks [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--output-dir`, `-d` | Base directory; a subdirectory per notebook is created inside |
| `--types`, `-t` | Comma-separated artifact types to include (default: all) |
| `--all-notebooks`, `-a` | Sweep every notebook in the account |
| `--skip-existing` | Skip artifacts whose file already exists (incremental re-runs) |

**Examples:**
```bash
nlm download all <nb-id> --output-dir ./exports
nlm download all --all-notebooks --output-dir ./exports --skip-existing
```

---

## Export Commands

### nlm export

Export artifacts to Google Docs or Sheets.

```bash
nlm export to-docs NOTEBOOK ARTIFACT_ID [--title TITLE] [--profile PROFILE]
nlm export to-sheets NOTEBOOK ARTIFACT_ID [--title TITLE] [--profile PROFILE]
nlm export artifact NOTEBOOK ARTIFACT_ID --type docs|sheets [--title TITLE] [--json] [--profile PROFILE]
```

`NOTEBOOK` accepts an ID or alias. `to-docs` exports a report; `to-sheets` exports a data table. `artifact` selects the destination with the required `--type` option. Each export needs exact authorization for the notebook, artifact, and hosted destination.

| Option | Commands | Description |
|--------|----------|-------------|
| `--title TITLE` | All three | Optional title for the exported document |
| `--profile PROFILE`, `-p PROFILE` | All three | Use specific profile |
| `--type docs\|sheets`, `-t docs\|sheets` | `artifact` only | Required export destination |
| `--json`, `-j` | `artifact` only | Output as JSON |

**Examples:**
```bash
nlm export to-sheets <nb-id> <artifact-id> --title "Data Table Export"
nlm export to-docs <nb-id> <artifact-id> --title "My Report"
nlm export artifact <nb-id> <artifact-id> -t docs --title "My Report" -j -p <profile>
```

---

## Sharing Commands

### nlm share status

Get current sharing settings for a notebook.

```bash
nlm share status <notebook-id> [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--profile` | Use specific profile |

### nlm share public

Enable public link sharing. This command only enables access.

```bash
nlm share public <notebook-id> [--profile PROFILE]
```

### nlm share private

Disable public link sharing. Invited collaborators retain access; this does not remove them.

```bash
nlm share private <notebook-id> [--profile PROFILE]
```

Both commands accept `--profile PROFILE` or `-p PROFILE`. Each change needs exact authorization for the notebook and access change. Verify the result with sharing status.

**Examples (run only the requested change):**
```bash
nlm share public <nb-id>    # Enable public link only if requested
nlm share private <nb-id>   # Disable public link only if requested
nlm share status <nb-id>    # Verify sharing settings and collaborators
```

### nlm share invite

Invite a collaborator by email.

```bash
nlm share invite <notebook-id> <email> [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--role` | `viewer` (default) or `editor` |
| `--profile` | Use specific profile |

**Examples:**
```bash
nlm share invite <nb-id> user@example.com
nlm share invite <nb-id> user@example.com --role editor
```

---

## Note Commands

### nlm note create

Create a note in a notebook.

```bash
nlm note create <notebook-id> [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--content` | Note content (required) |
| `--title` | Note title |
| `--profile` | Use specific profile |

### nlm note list

List all notes in a notebook.

```bash
nlm note list <notebook-id> [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |
| `--profile` | Use specific profile |

### nlm note update

Update an existing note.

```bash
nlm note update <notebook-id> <note-id> [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--content` | New content |
| `--title` | New title |
| `--profile` | Use specific profile |

### nlm note delete

Delete a note permanently.

```bash
nlm note delete <notebook-id> <note-id> [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--confirm` | **Required** to confirm deletion |
| `--profile` | Use specific profile |

## Chat Commands

### nlm chat start

Start interactive chat REPL session.

```bash
nlm chat start <notebook-id> [OPTIONS]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--profile` | `-p` | Use specific profile |

**REPL Commands:**
- `/sources` - List available sources
- `/clear` - Reset conversation context
- `/help` - Show available commands
- `/exit` - Exit the REPL

### nlm chat configure

Configure chat behavior for a notebook.

```bash
nlm chat configure <notebook-id> [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--goal` | `default`, `learning_guide`, `custom` |
| `--prompt` | Custom system prompt (required when goal is `custom`) |
| `--response-length` | `default`, `longer`, `shorter` |
| `--profile` | Use specific profile |

### nlm chats list

List chat sessions for a notebook.

```bash
nlm chats list <notebook-id> [OPTIONS]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--limit` | `-l` | Max chat sessions to display (default: 20) |
| `--json` | | Output raw JSON |
| `--profile` | `-p` | Use specific profile |

### nlm chats get

Retrieve the full Q&A transcript for a chat session. Transcripts are fetched
from the Gemini Notebook server, so past chats are visible even from a fresh CLI
invocation — not just chats made earlier in the same process.

```bash
nlm chats get <notebook-id> [conversation-id] [OPTIONS]
```

| Option | Short | Description |
|--------|-------|-------------|
| (positional) | | Conversation ID; defaults to the notebook's latest session |
| `--json` | | Output raw JSON |
| `--profile` | `-p` | Use specific profile |

### nlm chats export

Export a chat transcript to Markdown or JSON.

```bash
nlm chats export <notebook-id> [OPTIONS]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--conversation-id` | `-c` | Conversation ID; defaults to the latest session |
| `--format` | `-f` | `md` (default) or `json` |
| `--output` | `-o` | File path to save the export (prints to stdout if omitted) |
| `--profile` | `-p` | Use specific profile |

### nlm chats to-note

Save a chat turn or the full chat session as a Note in the notebook.

```bash
nlm chats to-note <notebook-id> <conversation-id> [OPTIONS]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--turn` | `-t` | 1-indexed turn to save (default: entire chat) |
| `--title` | | Note title |
| `--json` | | Output raw JSON |
| `--profile` | `-p` | Use specific profile |

---

## Alias Commands

### nlm alias set

Create or update an alias for a Gemini Notebook ID.

```bash
nlm alias set <name> <id>
```

Type is auto-detected. Notebook and source IDs are verified automatically.

### nlm alias get

Resolve an alias to its UUID.

```bash
nlm alias get <name>
```

### nlm alias list

List all aliases.

```bash
nlm alias list
```

### nlm alias delete

Delete an alias.

```bash
nlm alias delete <name>
```

---

## Config Commands

### nlm config show

Display current configuration.

```bash
nlm config show [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON instead of TOML |

### nlm config get

Get a specific configuration value.

```bash
nlm config get <key>
```

### nlm config set

Set a configuration value.

```bash
nlm config set <key> <value>
```

**Available Configuration Keys:**

| Key | Default | Description |
|-----|---------|-------------|
| `output.format` | `table` | Default output format (table, json) |
| `output.color` | `true` | Enable colored output |
| `output.short_ids` | `true` | Show shortened IDs |
| `auth.browser` | `auto` | Preferred login browser: auto, chrome, arc, dia, comet, brave, edge, chromium, firefox, vivaldi, opera. Falls back to auto if a preferred named browser is unavailable. |
| `auth.browser_path` | empty | Explicit Chromium-compatible executable; `NLM_BROWSER_PATH` overrides named discovery. |
| `auth.default_profile` | `default` | Profile to use when `--profile` not specified. **Note:** The MCP Server always uses the active default profile. Changing this setting will instantaneously switch the MCP server's Google account. |

**Example**: Set default profile to avoid typing `--profile` for every command:

```bash
# Preferred method (simpler)
nlm login switch work

# Alternative method (via config)
nlm config set auth.default_profile work
```

---

## Organization and Automation

### Labels

```bash
nlm label auto <notebook-id>
nlm label list <notebook-id>
nlm label reorganize <notebook-id> --confirm
nlm label create <notebook-id> "Research"
nlm label rename <notebook-id> <label-id> "New Name"
nlm label emoji <notebook-id> <label-id> "📚"
nlm label move <notebook-id> <source-id> <label-id>
nlm label delete <notebook-id> <label-id> --confirm
```

Full reorganization and deletion are destructive label operations. Sources are
preserved when labels are deleted.

### Tags and cross-notebook query

```bash
nlm tag add <notebook-id> --tags "ai,research"
nlm tag remove <notebook-id> --tags "ai"
nlm tag list
nlm tag select "ai research"
nlm cross query "Compare approaches" --notebooks "id1,id2"
nlm cross query "Summarize" --tags "ai,research"
nlm cross query "Everything" --all
```

### Batch operations

Resolve selectors to exact notebook targets before authorized mutations. Source ingestion needs separate authorization. Deletes require explicit confirmation of every exact target, even with `--confirm`.

```bash
nlm batch query "Summarize" --notebooks "id1,id2"
nlm batch add-source "https://example.com" --notebooks "id1,id2"
nlm batch create "Project A, Project B"
nlm batch delete --notebooks "id1,id2" --confirm
```

Do not use CLI batch Studio for generation: `nlm batch studio` has no confirmation option. MCP `batch(action="studio", ...)` ignores `confirm`; setting `confirm=True` does not fix this. Use individual CLI generation commands with `--confirm` or direct gated MCP `studio_create` calls for each authorized notebook and artifact.

### Pipelines

```bash
nlm pipeline list
nlm pipeline create my-pipeline --file pipeline.yaml
```

The `ingest-and-podcast`, `research-and-report`, and `multi-format` pipelines generate artifacts without Studio confirmation. Mutation pipelines lack granular gates for source ingestion, generation, and deletion. Do not run mutation pipelines. Use individual authorized operations with Studio confirmation and exact-target delete confirmation instead. Source ingestion remains separately authorized. Creating a pipeline is a separate local write, not permission to run it. Neither CLI nor MCP pipeline execution has a confirmation parameter.

Run `nlm <family> <command> --help` for selector and profile options.

---

## Setup, Skill, and Diagnostics

The distribution remains `notebooklm-mcp-cli` at 0.13.0, with executables `nlm` and `notebooklm-mcp`. New MCP connections use `gemini-notebook-mcp`. An old connection name is not a package rename or permission to replace a working configuration.

```bash
nlm setup                      # Interactive wizard for a human in a terminal
nlm setup list
nlm setup add <tool>
nlm setup remove <tool>

# Claude Desktop profile selection
nlm setup add claude-desktop --profile regular|3p|both
nlm setup remove claude-desktop --profile regular|3p|both

nlm skill list
nlm skill install <tool> [--level user|project]
nlm skill update [tool]
nlm skill uninstall <tool>
nlm skill show
nlm skill package [--output DIR]  # Local ZIP, not an upload

nlm doctor
nlm doctor --verbose
```

Claude Desktop setup only targets detected profiles. If both regular and
Relay AI/3P profiles exist, the command prompts for a selection unless
`--profile` is supplied; if no profile exists, nothing is created. Fully quit
the selected Claude profile before adding or removing MCP configuration. The
CLI refuses to write while the active Claude executable is running, including
when Relay AI launched it. User-level skill installation likewise requires the target tool to be detected.

The wizard offers status, add MCP, add skill, remove, copy setup, and exit; Esc returns to the previous screen. It lists detected tools, starts connection selection empty, and offers `notebooklm-mcp` or `notebooklm` connections under **Needs a fix**. Renaming to `gemini-notebook-mcp` is a separate configuration write that preserves other settings. Do not drive the interactive wizard as maintenance validation or choose adjacent writes.

MCP configuration defaults to app/user scope and uses the executable's full path. Codex CLI and ChatGPT desktop share a configuration on the same host. The wizard uses GitHub Copilot's VS Code user profile; direct `nlm setup add github-copilot` defaults to project scope unless `--scope user` is supplied. Skills default to **All my projects** (user level); choose `--level project` only for an authorized project install. Current/newer skill versions are kept. Replacing older or unversioned skills requires confirmation and backs up the old directory. Do not let this replace the locally adapted skill or its safety overlays.

`nlm skill package --output DIR` writes `DIR/nlm-skill.zip`, replacing an existing ZIP atomically. Without `--output`, it uses `~/Downloads` if present, otherwise the home directory. It packages the distribution's upstream skill, not this local adaptation, and moves upstream `version` into `metadata.version`. Review its contents and safety rules before any separately authorized upload.

Claude Desktop Chat/Cowork and claude.ai load account-uploaded skills through **Customize → Skills → Add**; the Desktop Code tab uses Claude Code's local skills. Packaging does not upload anything. Uploading to that account is a hosted mutation; adding skill content to a NotebookLM notebook is a separate hosted source mutation with an exact notebook target. The ZIP is for Claude skill import, not a supported NotebookLM source-file format. No setup or package request authorizes either upload.

Verb-first aliases are also available for common operations, including
`nlm create`, `nlm list`, `nlm get`, `nlm add`, `nlm rename`, `nlm delete`,
`nlm status`, `nlm describe`, `nlm query`, `nlm sync`, `nlm download`,
`nlm install skill`, and `nlm update skill`.
