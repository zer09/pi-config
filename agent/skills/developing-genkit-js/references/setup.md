# Genkit JS Setup

Use this reference for requested Genkit JS setup. Inspect existing imports, initialization, package scripts, lockfiles, and framework conventions first. Preserve package-manager and dependency pins. Setup does not authorize a live model call, provider/secret change, or deployment.

1. Match the requested deliverable. Do not create an image-generation or example flow merely because the workspace is empty.
2. Check to see if any Genkit provider plugin (such as `@genkit-ai/google-genai` or `@genkit-ai/oai-compat` or others, may start with `genkitx-*`) is installed.
   - Reuse the existing provider. If none is configured and the choice matters, ask which provider to use; do not silently default to Google AI.
   - For other providers, inspect installed source or official plugin docs. Add packages only within a requested setup/dependency task using compatible project pins.
   - For Next.js, inspect existing `@genkit-ai/next` integration before adding it; do not register it as a model provider.
3. Find the existing `genkit(` initialization, including imported aliases and beta entrypoints. Reuse it when present; do not duplicate configuration or stop before completing the requested repair.
4. Create an `ai` directory in the primary source directory of the project (this may be e.g. `src` but is project-dependent). Adapt this path if your project uses a different structure.
5. Create `{sourceDir}/ai/genkit.ts` and populate it using the example below. DO NOT add a `next` plugin to the file, ONLY add a model provider plugin to the plugins array:

```ts
import { genkit, z } from 'genkit';
// Import your chosen provider plugin here. Example:
import { googleAI } from '@genkit-ai/google-genai';

export const ai = genkit({
  plugins: [
    googleAI(), // Add your provider plugin here
  ],
  model: googleAI.model('gemini-2.5-flash'), // Set your provider's model here
});

export { z };
```

6. Create `{sourceDir}/ai/tools` and `{sourceDir}/ai/flows` directories, but leave them empty for now.
7. Create `{sourceDir}/ai/index.ts` and populate it with the following (change the import to match import aliases in `tsconfig.json` as needed):

```ts
import './genkit.js';
// import each created flow, tool, etc. here for use in the Genkit Dev UI
```

8. Add a development script only when the task needs it. Reuse installed or repository-pinned CLI and runner scripts; do not force CLI installation, package downloads, or a new script name. `genkit start -- <existing-run-command>` captures traces but stays running; do not start it merely to validate setup.
9. Check the requested local setup with available project checks. Report the deliverable, results, and deferred live/provider checks. Refer to required environment variable names (such as `GEMINI_API_KEY`) without reading, logging, or saving credential values.

## Next Steps & Troubleshooting

- **Documentation**: Use the [CLI](docs-and-cli.md) to access documentation (e.g., `genkit docs:search`).
- **Building Flows**: See [examples.md](examples.md) for patterns on creating flows, adding tools, and advanced configuration.
- **Troubleshooting**: If you encounter issues during setup or initialization, check [common-errors.md](common-errors.md) for solutions.
