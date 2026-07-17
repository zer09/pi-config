# Updating the gh-cli skill

Purpose: keep `agent/skills/gh-cli/SKILL.md` as a small runtime router, keep `references/index.md` as the command-family map, and keep exact command syntax in one reference file per command or subcommand.

## Local invariants

Before and after regenerating local command references, apply `local-skill-update-invariants.md`. Generated command content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility.

Preserve the local GitHub URL normalization rule: when a user supplies a GitHub HTTPS repository URL such as `https://github.com/zer09/pi-config`, the runtime skill must route through authenticated `gh` instead of web/HTTPS browsing. Normalize obvious URLs from memory to `OWNER/REPO` for `gh --repo OWNER/REPO ...` and to `git@github.com:OWNER/REPO.git` when using `gh repo clone` or Git remote operations. Keep `scripts/normalize_github_url.py` as the deterministic fallback parser for ambiguous or complex GitHub HTTPS and SSH URL shapes, and keep its compact JSON output limited to one primary `gh.argv` plus top-level `references` for valid routes.

## Sources

- Manual root: https://cli.github.com/manual/
- Command index: https://cli.github.com/manual/gh
- Local generator source: `gh help` output from the installed GitHub CLI. The base generation used `gh version 2.95.0 (2026-06-20)`. Changed help pages were refreshed from `gh version 2.96.0 (2026-07-08)`; unchanged pages retain their 2.95.0 attribution after a complete command-tree comparison found byte-identical help text.

## File model

- `agent/skills/gh-cli/SKILL.md`: frontmatter, operating rules, minimal local examples, and reference navigation. Keep it token-friendly.
- `agent/skills/gh-cli/references/index.md`: compact command-family map, runtime route, and reference path rules for discovery.
- `agent/skills/gh-cli/references/<command>.md`: top-level command manual, for example `references/auth.md`.
- `agent/skills/gh-cli/references/<command>/<subcommand>.md`: subcommand manual, for example `references/auth/login.md` and `references/pr/create.md`.
- `agent/skills/gh-cli/references/help/<topic>.md`: `gh help <topic>` pages, not command pages.
- `agent/skills/gh-cli/scripts/normalize_github_url.py`: single-argument, network-free parser for GitHub HTTPS and SSH URLs. It emits compact JSON with one primary `gh.argv` and top-level `references` entries that point back into `agent/skills/gh-cli/references/`.
- `agent/skills/gh-cli/agents/openai.yaml`: UI metadata only. Regenerate if SKILL.md trigger intent changes.

## Update workflow for a future agent

1. Load the `skill-creator` and `gh-cli` skills, then read this file.
2. Check the official manual and installed CLI version: `gh --version`, https://cli.github.com/manual/, and https://cli.github.com/manual/gh.
3. Walk `gh help` recursively from the root command categories: Core commands, GitHub Actions commands, Alias commands, and Additional commands. Treat any `* COMMANDS` section inside a command help page as subcommands.
4. For each command path, write exactly one reference file using this mapping:
   - `gh auth` -> `agent/skills/gh-cli/references/auth.md`
   - `gh auth login` -> `agent/skills/gh-cli/references/auth/login.md`
   - `gh codespace ports forward` -> `agent/skills/gh-cli/references/codespace/ports/forward.md`
5. Keep generated reference files self-contained: source URL, generator version, summary, subcommand links, and full `gh help ...` manual text.
6. Update `SKILL.md` only with compact routing guidance, and update `references/index.md` with command-family entries. Do not paste full manual text into `SKILL.md`.
7. Preserve the GitHub mutation gate, secret-protection rules, and HTTPS-repository-URL normalization rule in `SKILL.md`.
8. Preserve `scripts/normalize_github_url.py`; when adding URL kinds, return one primary argv array rather than shell strings, avoid alternate argv fields such as `clone_argv`, and include the exact top-level `references/...` files an agent should read before running `gh`.
9. Keep this central update process linked from `SKILL.md`; do not add a duplicate update-process file inside the skill bundle.
10. Validate with `uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/gh-cli` when PyYAML is not already installed.
11. Smoke-test the URL normalizer with at least HTTPS repo, SSH repo, pull request, issue, discussion, issue comment, review comment, action run, release, file blob, directory tree, and slash-ref blob/tree URLs. Verify valid outputs have top-level `references`, `gh.argv`, no `gh.references`, and no `clone_argv`; verify `http://github.com/...`, malformed URLs with decoded path/query/fragment control characters, and ambiguous blob/tree URLs whose refs may contain slashes are rejected as unsupported.

## Current generated command references

- `gh agent-task` -> `references/agent-task.md`
- `gh agent-task create` -> `references/agent-task/create.md`
- `gh agent-task list` -> `references/agent-task/list.md`
- `gh agent-task view` -> `references/agent-task/view.md`
- `gh alias` -> `references/alias.md`
- `gh alias delete` -> `references/alias/delete.md`
- `gh alias import` -> `references/alias/import.md`
- `gh alias list` -> `references/alias/list.md`
- `gh alias set` -> `references/alias/set.md`
- `gh api` -> `references/api.md`
- `gh attestation` -> `references/attestation.md`
- `gh attestation download` -> `references/attestation/download.md`
- `gh attestation trusted-root` -> `references/attestation/trusted-root.md`
- `gh attestation verify` -> `references/attestation/verify.md`
- `gh auth` -> `references/auth.md`
- `gh auth login` -> `references/auth/login.md`
- `gh auth logout` -> `references/auth/logout.md`
- `gh auth refresh` -> `references/auth/refresh.md`
- `gh auth setup-git` -> `references/auth/setup-git.md`
- `gh auth status` -> `references/auth/status.md`
- `gh auth switch` -> `references/auth/switch.md`
- `gh auth token` -> `references/auth/token.md`
- `gh browse` -> `references/browse.md`
- `gh cache` -> `references/cache.md`
- `gh cache delete` -> `references/cache/delete.md`
- `gh cache list` -> `references/cache/list.md`
- `gh co` -> `references/co.md`
- `gh codespace` -> `references/codespace.md`
- `gh codespace code` -> `references/codespace/code.md`
- `gh codespace cp` -> `references/codespace/cp.md`
- `gh codespace create` -> `references/codespace/create.md`
- `gh codespace delete` -> `references/codespace/delete.md`
- `gh codespace edit` -> `references/codespace/edit.md`
- `gh codespace jupyter` -> `references/codespace/jupyter.md`
- `gh codespace list` -> `references/codespace/list.md`
- `gh codespace logs` -> `references/codespace/logs.md`
- `gh codespace ports` -> `references/codespace/ports.md`
- `gh codespace ports forward` -> `references/codespace/ports/forward.md`
- `gh codespace ports visibility` -> `references/codespace/ports/visibility.md`
- `gh codespace rebuild` -> `references/codespace/rebuild.md`
- `gh codespace ssh` -> `references/codespace/ssh.md`
- `gh codespace stop` -> `references/codespace/stop.md`
- `gh codespace view` -> `references/codespace/view.md`
- `gh completion` -> `references/completion.md`
- `gh config` -> `references/config.md`
- `gh config clear-cache` -> `references/config/clear-cache.md`
- `gh config get` -> `references/config/get.md`
- `gh config list` -> `references/config/list.md`
- `gh config set` -> `references/config/set.md`
- `gh copilot` -> `references/copilot.md`
- `gh discussion` -> `references/discussion.md`
- `gh discussion comment` -> `references/discussion/comment.md`
- `gh discussion create` -> `references/discussion/create.md`
- `gh discussion edit` -> `references/discussion/edit.md`
- `gh discussion list` -> `references/discussion/list.md`
- `gh discussion view` -> `references/discussion/view.md`
- `gh extension` -> `references/extension.md`
- `gh extension browse` -> `references/extension/browse.md`
- `gh extension create` -> `references/extension/create.md`
- `gh extension exec` -> `references/extension/exec.md`
- `gh extension install` -> `references/extension/install.md`
- `gh extension list` -> `references/extension/list.md`
- `gh extension remove` -> `references/extension/remove.md`
- `gh extension search` -> `references/extension/search.md`
- `gh extension upgrade` -> `references/extension/upgrade.md`
- `gh gist` -> `references/gist.md`
- `gh gist clone` -> `references/gist/clone.md`
- `gh gist create` -> `references/gist/create.md`
- `gh gist delete` -> `references/gist/delete.md`
- `gh gist edit` -> `references/gist/edit.md`
- `gh gist list` -> `references/gist/list.md`
- `gh gist rename` -> `references/gist/rename.md`
- `gh gist view` -> `references/gist/view.md`
- `gh gpg-key` -> `references/gpg-key.md`
- `gh gpg-key add` -> `references/gpg-key/add.md`
- `gh gpg-key delete` -> `references/gpg-key/delete.md`
- `gh gpg-key list` -> `references/gpg-key/list.md`
- `gh issue` -> `references/issue.md`
- `gh issue close` -> `references/issue/close.md`
- `gh issue comment` -> `references/issue/comment.md`
- `gh issue create` -> `references/issue/create.md`
- `gh issue delete` -> `references/issue/delete.md`
- `gh issue develop` -> `references/issue/develop.md`
- `gh issue edit` -> `references/issue/edit.md`
- `gh issue list` -> `references/issue/list.md`
- `gh issue lock` -> `references/issue/lock.md`
- `gh issue pin` -> `references/issue/pin.md`
- `gh issue reopen` -> `references/issue/reopen.md`
- `gh issue status` -> `references/issue/status.md`
- `gh issue transfer` -> `references/issue/transfer.md`
- `gh issue unlock` -> `references/issue/unlock.md`
- `gh issue unpin` -> `references/issue/unpin.md`
- `gh issue view` -> `references/issue/view.md`
- `gh label` -> `references/label.md`
- `gh label clone` -> `references/label/clone.md`
- `gh label create` -> `references/label/create.md`
- `gh label delete` -> `references/label/delete.md`
- `gh label edit` -> `references/label/edit.md`
- `gh label list` -> `references/label/list.md`
- `gh licenses` -> `references/licenses.md`
- `gh org` -> `references/org.md`
- `gh org list` -> `references/org/list.md`
- `gh pr` -> `references/pr.md`
- `gh pr checkout` -> `references/pr/checkout.md`
- `gh pr checks` -> `references/pr/checks.md`
- `gh pr close` -> `references/pr/close.md`
- `gh pr comment` -> `references/pr/comment.md`
- `gh pr create` -> `references/pr/create.md`
- `gh pr diff` -> `references/pr/diff.md`
- `gh pr edit` -> `references/pr/edit.md`
- `gh pr list` -> `references/pr/list.md`
- `gh pr lock` -> `references/pr/lock.md`
- `gh pr merge` -> `references/pr/merge.md`
- `gh pr ready` -> `references/pr/ready.md`
- `gh pr reopen` -> `references/pr/reopen.md`
- `gh pr revert` -> `references/pr/revert.md`
- `gh pr review` -> `references/pr/review.md`
- `gh pr status` -> `references/pr/status.md`
- `gh pr unlock` -> `references/pr/unlock.md`
- `gh pr update-branch` -> `references/pr/update-branch.md`
- `gh pr view` -> `references/pr/view.md`
- `gh preview` -> `references/preview.md`
- `gh preview prompter` -> `references/preview/prompter.md`
- `gh project` -> `references/project.md`
- `gh project close` -> `references/project/close.md`
- `gh project copy` -> `references/project/copy.md`
- `gh project create` -> `references/project/create.md`
- `gh project delete` -> `references/project/delete.md`
- `gh project edit` -> `references/project/edit.md`
- `gh project field-create` -> `references/project/field-create.md`
- `gh project field-delete` -> `references/project/field-delete.md`
- `gh project field-list` -> `references/project/field-list.md`
- `gh project item-add` -> `references/project/item-add.md`
- `gh project item-archive` -> `references/project/item-archive.md`
- `gh project item-create` -> `references/project/item-create.md`
- `gh project item-delete` -> `references/project/item-delete.md`
- `gh project item-edit` -> `references/project/item-edit.md`
- `gh project item-list` -> `references/project/item-list.md`
- `gh project link` -> `references/project/link.md`
- `gh project list` -> `references/project/list.md`
- `gh project mark-template` -> `references/project/mark-template.md`
- `gh project unlink` -> `references/project/unlink.md`
- `gh project view` -> `references/project/view.md`
- `gh release` -> `references/release.md`
- `gh release create` -> `references/release/create.md`
- `gh release delete` -> `references/release/delete.md`
- `gh release delete-asset` -> `references/release/delete-asset.md`
- `gh release download` -> `references/release/download.md`
- `gh release edit` -> `references/release/edit.md`
- `gh release list` -> `references/release/list.md`
- `gh release upload` -> `references/release/upload.md`
- `gh release verify` -> `references/release/verify.md`
- `gh release verify-asset` -> `references/release/verify-asset.md`
- `gh release view` -> `references/release/view.md`
- `gh repo` -> `references/repo.md`
- `gh repo archive` -> `references/repo/archive.md`
- `gh repo autolink` -> `references/repo/autolink.md`
- `gh repo autolink create` -> `references/repo/autolink/create.md`
- `gh repo autolink delete` -> `references/repo/autolink/delete.md`
- `gh repo autolink list` -> `references/repo/autolink/list.md`
- `gh repo autolink view` -> `references/repo/autolink/view.md`
- `gh repo clone` -> `references/repo/clone.md`
- `gh repo create` -> `references/repo/create.md`
- `gh repo delete` -> `references/repo/delete.md`
- `gh repo deploy-key` -> `references/repo/deploy-key.md`
- `gh repo deploy-key add` -> `references/repo/deploy-key/add.md`
- `gh repo deploy-key delete` -> `references/repo/deploy-key/delete.md`
- `gh repo deploy-key list` -> `references/repo/deploy-key/list.md`
- `gh repo edit` -> `references/repo/edit.md`
- `gh repo fork` -> `references/repo/fork.md`
- `gh repo gitignore` -> `references/repo/gitignore.md`
- `gh repo gitignore list` -> `references/repo/gitignore/list.md`
- `gh repo gitignore view` -> `references/repo/gitignore/view.md`
- `gh repo license` -> `references/repo/license.md`
- `gh repo license list` -> `references/repo/license/list.md`
- `gh repo license view` -> `references/repo/license/view.md`
- `gh repo list` -> `references/repo/list.md`
- `gh repo read-dir` -> `references/repo/read-dir.md`
- `gh repo read-file` -> `references/repo/read-file.md`
- `gh repo rename` -> `references/repo/rename.md`
- `gh repo set-default` -> `references/repo/set-default.md`
- `gh repo sync` -> `references/repo/sync.md`
- `gh repo unarchive` -> `references/repo/unarchive.md`
- `gh repo view` -> `references/repo/view.md`
- `gh ruleset` -> `references/ruleset.md`
- `gh ruleset check` -> `references/ruleset/check.md`
- `gh ruleset list` -> `references/ruleset/list.md`
- `gh ruleset view` -> `references/ruleset/view.md`
- `gh run` -> `references/run.md`
- `gh run cancel` -> `references/run/cancel.md`
- `gh run delete` -> `references/run/delete.md`
- `gh run download` -> `references/run/download.md`
- `gh run list` -> `references/run/list.md`
- `gh run rerun` -> `references/run/rerun.md`
- `gh run view` -> `references/run/view.md`
- `gh run watch` -> `references/run/watch.md`
- `gh search` -> `references/search.md`
- `gh search code` -> `references/search/code.md`
- `gh search commits` -> `references/search/commits.md`
- `gh search issues` -> `references/search/issues.md`
- `gh search prs` -> `references/search/prs.md`
- `gh search repos` -> `references/search/repos.md`
- `gh secret` -> `references/secret.md`
- `gh secret delete` -> `references/secret/delete.md`
- `gh secret list` -> `references/secret/list.md`
- `gh secret set` -> `references/secret/set.md`
- `gh skill` -> `references/skill.md`
- `gh skill install` -> `references/skill/install.md`
- `gh skill list` -> `references/skill/list.md`
- `gh skill preview` -> `references/skill/preview.md`
- `gh skill publish` -> `references/skill/publish.md`
- `gh skill search` -> `references/skill/search.md`
- `gh skill update` -> `references/skill/update.md`
- `gh ssh-key` -> `references/ssh-key.md`
- `gh ssh-key add` -> `references/ssh-key/add.md`
- `gh ssh-key delete` -> `references/ssh-key/delete.md`
- `gh ssh-key list` -> `references/ssh-key/list.md`
- `gh status` -> `references/status.md`
- `gh variable` -> `references/variable.md`
- `gh variable delete` -> `references/variable/delete.md`
- `gh variable get` -> `references/variable/get.md`
- `gh variable list` -> `references/variable/list.md`
- `gh variable set` -> `references/variable/set.md`
- `gh workflow` -> `references/workflow.md`
- `gh workflow disable` -> `references/workflow/disable.md`
- `gh workflow enable` -> `references/workflow/enable.md`
- `gh workflow list` -> `references/workflow/list.md`
- `gh workflow run` -> `references/workflow/run.md`
- `gh workflow view` -> `references/workflow/view.md`

## Current help topic references

- `gh help accessibility` -> `references/help/accessibility.md`
- `gh help actions` -> `references/help/actions.md`
- `gh help environment` -> `references/help/environment.md`
- `gh help exit-codes` -> `references/help/exit-codes.md`
- `gh help formatting` -> `references/help/formatting.md`
- `gh help mintty` -> `references/help/mintty.md`
- `gh help reference` -> `references/help/reference.md`
- `gh help telemetry` -> `references/help/telemetry.md`
