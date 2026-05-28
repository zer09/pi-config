---
name: firebase-ai-logic-basics
description: Official skill for integrating Firebase AI Logic (Gemini API) into web applications. Use when adding Firebase AI Logic, Gemini API calls, multimodal inference, structured output, or secure client-side AI features.
---

# Firebase AI Logic Basics

Use Firebase AI Logic when adding Gemini-powered features through Firebase SDKs. Keep runtime guidance compact and load platform references only when needed.

## Hosted service safety

- Firebase and Google Cloud are external hosted services. Reads, local code edits, and local validation are allowed.
- Do not enable services, change projects, deploy, alter billing/quota, write secrets, or run live model calls unless the user explicitly requests that exact action.
- Never hardcode API keys, app credentials, service account JSON, OAuth tokens, or private keys. Use Firebase config files, environment variables, or placeholders.
- For sensitive prompts or user data, design server-side mediation or App Check patterns instead of exposing privileged credentials to clients.

## Workflow

1. Identify the target platform: Web, Android, iOS, Flutter, or another Firebase-supported client.
2. Verify the existing Firebase app setup before adding AI Logic code. Use `firebase-basics` if project/app initialization is unclear.
3. Load the smallest relevant reference:
   - [Web usage patterns](references/usage_patterns_web.md)
   - [Android usage patterns](references/usage_patterns_android.md)
   - [iOS setup](references/ios_setup.md)
   - [Flutter setup](references/flutter_setup.md)
4. Add the minimal SDK initialization and model call needed by the feature.
5. Validate error handling for auth state, App Check, network failures, quota errors, safety blocks, and unsupported input types.
6. If structured output, tool use, file input, streaming, or multimodal input is involved, verify current SDK support from local package docs or current Firebase docs before coding.

## Implementation reminders

- Keep client-side AI features least-privileged. Do not put administrative credentials in mobile or web clients.
- Prefer explicit model names and typed response parsing over loose JSON assumptions.
- Add user-visible fallback states for blocked, empty, partial, or rate-limited responses.
- Use Context Mode for large docs, SDK source reads, generated types, or test output.

## Maintenance

Update this Local Skill using `../../../docs/skills/firebase-skills-update-process.md`. Preserve the local invariants in `../../../docs/skills/local-skill-update-invariants.md`.
