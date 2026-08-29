# Impeccable skill update process

Use this process to update the locally adapted Impeccable skill in `agent/skills/impeccable/`.

## Classification and provenance

- Classification: `keep it`.
- Upstream: <https://github.com/pbakaus/impeccable>.
- Reviewed local checkout: `~/development/impeccable/`.
- Installed source snapshot: upstream's tracked `.pi/skills/impeccable/` payload.
- Initial source commit: `b0594c72d18006b5865c70eb3a97e8b04064e600`.
- Initial generated skill version: `4.1.2`.
- Upstream package version at that commit: `3.6.1`.
- License: Apache-2.0. Preserve `agent/skills/impeccable/LICENSE`.

The generated skill version and package version are independent. Record both during each update instead of assuming they match.

## Local installation shape

The local copy is a regular-file global Pi skill under `agent/skills/impeccable/`. Do not replace it with:

- a project-local `.pi/skills/impeccable/` installation;
- a symlink to the upstream checkout;
- an external skill path in `agent/settings.json`;
- `npx impeccable install`, `npx impeccable update`, or the upstream link command.

The upstream installer and updater remove and recopy the destination. Running either command on the local copy would erase the local frontmatter, command paths, safety gates, and Pi compatibility overlays.

## Local overlays to preserve

Reapply and verify all of these after importing upstream changes:

1. Keep `SKILL.md` frontmatter limited to `name`, `description`, and `disable-model-invocation: true`.
2. Keep the skill explicit-only. Its Pi invocation is `/skill:impeccable [command]`.
3. Keep `agents/openai.yaml` with a 25-64 character short description and a default prompt containing `$impeccable`.
4. Keep executable Markdown examples global-safe through `${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/impeccable/scripts/`.
5. Keep `scripts/lib/provider.mjs` on the `/skill:` command prefix.
6. Keep Pin/Unpin unsupported for the global Pi installation.
7. Keep Pi automatic hooks unsupported. Use the bundled detector manually, and require an exact user request before changing another harness's hook manifest.
8. Keep Impeccable-native subagent roles on the bundled `reference/degraded/` fallbacks. Every Pi playbook must treat these roles as unavailable even though `delegate_run` is exposed; do not map them to its fixed repository roles.
9. Keep anonymous choice telemetry disabled unless an explicitly authorized command sets `IMPECCABLE_ALLOW_TELEMETRY=1`.
10. Keep `generate-image.mjs` blocked unless an explicitly authorized billed command sets `IMPECCABLE_ALLOW_IMAGE_API=1`. Disclose every local `--ref` image uploaded to OpenAI.
11. Keep update notices pointing to this document. Never let runtime output recommend blind self-update.
12. Keep the Apache-2.0 license file and prominent local-change documentation.
13. Keep `impeccable` in the delegated resource policy's excluded partition until browser, visual, hosted-service, and recursive workflow support is reviewed explicitly.
14. Keep credential examples neutral. Use placeholders such as `<token>` or environment variable names, never realistic secret-shaped prefixes.

## Update workflow

1. Read `docs/skills/README.md`, `local-skill-update-invariants.md`, and `skill-slimming-process.md`.
2. Confirm the upstream checkout has no unexpected tracked changes.
3. Update the checkout only when the user requested an upstream synchronization.
4. Record the upstream commit, generated skill version, and package version.
5. Review changes in upstream `skill/SKILL.src.md`, `skill/reference/`, `skill/scripts/`, `scripts/build.js`, and `.pi/skills/impeccable/`.
6. Copy the reviewed tracked `.pi/skills/impeccable/` payload to a temporary comparison directory, not over the local skill.
7. Compare the temporary payload with `agent/skills/impeccable/`.
8. Import reviewed runtime changes while reapplying every local overlay above.
9. Preserve `agents/openai.yaml`, `LICENSE`, and the `## Maintenance` pointer.
10. Update this document when provenance, local divergence, or the repeatable workflow changes.
11. Update `installed-skills-trim-verdict.md`, `docs/skills/README.md`, `docs/config-context-cost.md`, and `docs/CHANGELOG.md` when their recorded facts change.

## Validation

Run the target validator:

```bash
uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py agent/skills/impeccable
```

Then run the all-skill validator loop from `local-skill-update-invariants.md`.

Also verify:

```bash
find agent/skills/impeccable/scripts -type f \( -name '*.js' -o -name '*.mjs' \) -print0 \
  | xargs -0 -n1 node --check

IMPECCABLE_IMAGE_GEN_FAKE=1 node agent/skills/impeccable/scripts/generate-image.mjs \
  --prompt "offline validation" --out /tmp/impeccable-fake.png
```

Confirm that:

- no executable Markdown example uses project-relative `.pi/skills/impeccable/` paths;
- no user-facing instruction recommends `/impeccable`, `npx impeccable install`, or `npx impeccable update`;
- a non-fake image call without `IMPECCABLE_ALLOW_IMAGE_API=1` fails before reading the API key or making a request;
- choice telemetry stays disabled without `IMPECCABLE_ALLOW_TELEMETRY=1`;
- no symlink, cache, log, secret, or literal user-specific home path exists in the skill;
- `agents/openai.yaml` parses and satisfies local interface constraints;
- delegated resource-policy tests pass with Impeccable excluded;
- `git diff --check` passes.

Do not run a billed image call, upload a reference image, mutate a hosted service, stage, commit, or push as part of routine validation.
