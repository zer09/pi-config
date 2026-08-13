# openai-codex-aliases

This extension registers named OpenAI Codex providers for separate ChatGPT Plus or Pro accounts.
It leaves Pi's built-in `openai-codex` provider unchanged.

Initial providers:

| Account | Provider ID | Display name |
|---|---|---|
| Personal | `openai-codex-personal` | `OpenAI Codex Personal` |
| Business | `openai-codex-business` | `OpenAI Codex Business` |

## Architecture

The extension reads Pi's freshly constructed provider set from `@earendil-works/pi-ai/providers/all`.
Pi constructs the selected `openai-codex` entry with its built-in `openaiCodexProvider()` factory.
Each alias reuses the built-in OAuth methods, API implementation, base URL, and current model catalog.
The extension clones model metadata and changes only the provider ID.

Pi stores one OAuth credential per provider ID.
Personal, Business, and canonical `openai-codex` credentials therefore remain independent.
A session stores the selected alias provider ID and restores that alias when the session resumes.

The stream adapter maps the active alias to canonical `openai-codex` only for the delegated built-in request.
The adapter maps emitted assistant messages back to the visible alias.
Only history from the active alias receives canonical identity inside that request.
History from canonical Codex, another alias, or another provider remains foreign.
This rule prevents encrypted reasoning, native tool-call IDs, and related provider state from crossing accounts.

## Configuration

Edit `aliases.json`:

```json
{
  "aliases": [
    { "slug": "personal", "name": "OpenAI Codex Personal" },
    { "slug": "business", "name": "OpenAI Codex Business" }
  ]
}
```

Each item accepts only:

- `slug`: 1 to 32 lowercase letters, digits, or internal hyphens.
- `name`: a non-empty display name.

The provider ID is `openai-codex-${slug}`.
Slugs must be unique.
Do not put credentials, tokens, or other fields in `aliases.json`.

Add another JSON item to add an account.
Restart Pi or run `/reload` after a change.
Keep each slug stable because sessions bind to the derived provider ID.

## Login and model selection

Complete browser login flows sequentially.
Concurrent flows can compete for the same local callback port.

```text
/login openai-codex-personal
/login openai-codex-business
/model
```

Explicit CLI selection:

```bash
pi --provider openai-codex-personal --model gpt-5.6-sol
pi --provider openai-codex-business --model gpt-5.6-sol
```

`/model` shows the same built-in Codex catalog under each distinct provider ID.
The footer keeps account identity visible, such as `codex-personal/Sol` or `codex-business/Sol`.
Minimal layouts use `personal/Sol` and `business/Sol`.

Aliases share upstream quotas only when the aliases use the same upstream ChatGPT account.
Different upstream accounts keep their own quotas.

## Remove an alias

Run `/logout` for the alias before deleting its JSON entry.
Then delete the entry and restart Pi or run `/reload`.

Removing an alias does not delete its stored credential.
If logout does not happen first, the credential becomes orphaned under the old provider ID.
Sessions that reference a removed alias remain intact, but Pi cannot restore that model until the alias returns.

Never commit, print, or copy `agent/auth.json`.

## Testing

```sh
node --check agent/extensions/openai-codex-aliases/test.cjs
node agent/extensions/openai-codex-aliases/test.cjs
```

The tests use a fake source provider and do not contact OpenAI or start OAuth.
