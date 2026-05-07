# Manifest + Pi Setup Plan

## 1) Choose deployment mode
- Decide: Cloud (`app.manifest.build`) or self-hosted (`localhost:2099`).
- Recommendation: start Cloud first, then self-host later.

## 2) Create Manifest account and agent key
- Sign in.
- Create one Agent key.
- Keep key in an env var, do not hardcode.

## 3) Configure providers inside Manifest
- Add your upstream providers (OpenAI/Anthropic/local/custom).
- Verify each provider key/connection works.

## 4) Configure routing policy
- Set tier strategy: simple -> cheap model, complex -> strong model.
- Add fallback chain per tier (2-3 models each).

## 5) Set safeguards
- Enable spend limits and alerts.
- Set provider timeout values appropriate for your workflow.

## 6) Integrate with Pi
- Add/update `~/.pi/agent/models.json`:
 - `baseUrl`: Manifest URL
 - `apiKey`: env var for the Manifest agent key
 - `api`: `openai-completions`
 - model: `manifest/auto`

## 7) Validate end-to-end
- Run small prompt, coding prompt, long-context prompt.
- Confirm responses work and routing logs show different selected models.

## 8) Verify continuity behavior
- Run multi-turn chat in Pi.
- Confirm context is preserved across turns even when routed model changes.

## 9) Tune routing after real usage
- Review cost and latency.
- Adjust tier thresholds and fallback order.

## 10) Rollback plan
- Keep current Pi model config backed up.
- If issues, switch Pi back to direct provider quickly.
