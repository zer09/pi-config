---
name: firebase-ai-logic-basics
description: Integrate Firebase AI Logic in Web, Android, iOS, Flutter, or Unity apps. Use for Gemini features through Firebase client SDKs, including multimodal input, streaming, and structured output, not generic Gemini API or Genkit work.
---

# Firebase AI Logic Basics

Use Firebase AI Logic when adding Gemini-powered features through Firebase SDKs. Keep runtime guidance compact and load platform references only when needed.

## Hosted service safety

- Firebase and Google Cloud are external hosted services. Reads, local code edits, and local validation are allowed.
- Do not enable services, change projects, deploy, alter billing/quota, write secrets, or run live model calls unless the user explicitly requests that exact action and target.
- Never hardcode API keys, app credentials, service account JSON, OAuth tokens, or private keys. Use Firebase config files, environment variables, or placeholders.
- For sensitive prompts or user data, design server-side mediation or App Check patterns instead of exposing privileged credentials to clients.

## Workflow

1. Identify the target platform: Web, Android, iOS, Flutter, or Unity. For Unity, use the [official setup guide](https://firebase.google.com/docs/ai-logic/get-started).
2. Reuse existing Firebase config, app initialization, and compatible client dependencies. Use `firebase-basics` only for a separate setup requirement. Client code changes do not require CLI login, live project discovery, or service enablement. Use installed or repository-pinned tooling; ask before download/install or upgrades.
3. Load the smallest relevant reference:
   - [Web usage patterns](references/usage_patterns_web.md)
   - [Android usage patterns](references/usage_patterns_android.md)
   - [iOS setup](references/ios_setup.md)
   - [Flutter setup](references/flutter_setup.md)
4. Add the minimal SDK initialization and model call needed by the feature.
5. Validate error handling for auth state, App Check, network failures, quota errors, safety blocks, and unsupported input types.
6. If structured output, tool use, file input, streaming, or multimodal input is involved, verify current SDK support from local package docs or current Firebase docs before coding.

## Implementation reminders

- Prefer the Gemini Developer API for prototyping and standard use. Use the Agent Platform Gemini API, formerly Vertex AI Gemini API, only for enterprise scale, data-residency, or other explicit requirements; Agent Platform requires Blaze billing.
- App Check attestation rejects emulators, simulators, and many CI environments. Use registered App Check debug tokens for local or CI validation, pass them through environment variables, and never commit token values.
- Keep client-side AI features least-privileged. Do not put administrative credentials in mobile or web clients.
- Select a supported model for the chosen provider and feature from the [model documentation](https://firebase.google.com/docs/ai-logic/models.md.txt). Replace model placeholders in examples; do not assume old model names remain available. Prefer typed response parsing over loose JSON assumptions.
- Add user-visible fallback states for blocked, empty, partial, or rate-limited responses.
- Keep large docs, SDK source reads, generated types, and test output bounded; capture only relevant excerpts or save verbose output to temp files.

## Maintenance

Update this Local Skill using `../../../docs/skills/firebase-skills-update-process.md`. Preserve the local invariants in `../../../docs/skills/local-skill-update-invariants.md`.
