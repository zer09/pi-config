<!-- nlm-skill-start -->
<!-- nlm-version: 0.9.6 -->
## NLM - Gemini Notebook (formerly Google NotebookLM) CLI Expert

Use for requested NotebookLM/Gemini Notebook operations or troubleshooting through the `nlm` CLI or MCP, not generic research, podcasts, or document critique.

Apply the [skill root](../SKILL.md) for tool choice and safety. These examples are optional recipes, not authorization to execute their mutation steps. Reads do not authorize writes. Every create/add/import/generate/rename/share/invite/export/sync/configure/tag/delete action requires an exact user request and target. An unambiguous create/generate request needs no extra approval; deletes still require explicit confirmation. Never print cookies, tokens, profile secrets, or raw auth headers. Keep output bounded and read the [remote MCP security reference](remote-mcp.md) before remote access.

### Quick Reference

```bash
nlm login                    # Authenticate with NotebookLM
nlm notebook create "Title"  # Create notebook
nlm source add <id> --url "https://..."  # Add web source
nlm audio create <id> --confirm          # Generate podcast
nlm research start "query" --notebook-id <id>  # Discover sources
nlm research start "query" --title "New Research"  # Create destination notebook
```

### Critical Rules

1. **Authenticate when needed**: Run `nlm login` for setup or confirmed stale credentials
2. **Do not treat `unverified` as expired**: Check connectivity or try an API call first
3. **`--confirm` required** for generation/delete commands
4. **Capture IDs from output** for subsequent operations
5. **Check existing aliases first**; use `nlm alias set` only when alias creation is requested
6. **⚠️ NEVER auto-delete**: Always ask user before `nlm delete`
7. **⚠️ NEVER use `nlm chat start`**: It's an interactive REPL. Use `nlm notebook query` instead
8. **Use the existing configured MCP name**: The executable remains `notebooklm-mcp`. Registration or configuration changes require an exact user request and target.
9. **Never configure blindly**: `nlm setup` verifies the MCP executable and detected client profile before writing. User-level skills require the target tool to be detected; use `--level project` for an intentional project-local install.

### Common Workflows

**Research → Podcast Pipeline:**
```bash
nlm notebook create "AI Research"
nlm alias set ai <notebook-id>
nlm research start "AI trends" --notebook-id ai --mode deep
nlm research status ai --max-wait 900
nlm research import ai <task-id>
nlm audio create ai --confirm
nlm studio status ai
```

**Quick Content Ingestion:**
```bash
nlm source add <id> --url "https://example.com"
nlm source add <id> --text "Notes..." --title "My Notes"
nlm source add <id> --drive <doc-id>
```

**Study Materials:**
```bash
nlm report create <id> --format "Study Guide" --confirm
nlm quiz create <id> --count 10 --focus "Key Concepts" --confirm
nlm flashcards create <id> --focus "Vocabulary" --confirm
```

**Multi-Notebook Operations:**
```bash
nlm tag add <id> --tags "ai,research"                     # Tag notebooks
nlm batch query "Summarize" --tags "ai"                   # Batch query by tag
nlm cross query "Compare approaches" --notebooks "id1,id2"  # Cross-notebook query
nlm pipeline run ingest-and-podcast --notebook <id> --input-url "https://..."
```

### Full Documentation

Use the installed skill's [command reference](command_reference.md), [troubleshooting](troubleshooting.md), and [workflows](workflows.md). Installation commands below apply only when the user requests installation or update for the specified tool:

```bash
# Install via uv
uv tool install notebooklm-mcp-cli

# Then install/update skill for your AI tool
nlm skill install <tool>  # Install (claude-code, agents, opencode, etc)
nlm skill update <tool>   # Update existing skill
```

Or view inline: `nlm --ai`

<!-- nlm-skill-end -->
