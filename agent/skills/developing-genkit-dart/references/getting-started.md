# Getting Started with Genkit Dart

## Project setup

Inspect the project's Dart/Flutter SDK constraints, `pubspec.yaml`, lockfile, and existing Genkit plugin imports. For a requested new setup, use the project's package workflow and choose compatible Genkit, provider, and Schemantic versions. Do not upgrade an existing project merely to match an example.

See [Core framework](genkit.md) for initialization and generation examples. Use [Schemantic](schemantic.md) when defining typed inputs or outputs and generating schema code.

## Optional Genkit CLI

The CLI supplies a Developer UI for tracing, flow inspection, and interactive testing. It is not required for ordinary code or documentation changes.

Check the existing installation:

```bash
genkit --version
```

If CLI installation is part of the requested setup, one installation option is:

```bash
npm install -g genkit-cli
```

Use the project's approved installation method. Do not run a downloaded installer or change global tooling automatically.

## Developer UI

Starting a local application can execute startup code; running a flow or model from the UI can call hosted services. Review the entrypoint first. Live model/API calls, provider changes, and Firebase/GCP mutations require explicit user instruction for the exact action. Never print, save, or commit credentials or sensitive trace content.

For an authorized local development session with a safe entrypoint:

```bash
genkit start -- dart run main.dart
```

Match the command to the project's entrypoint. Inspect only relevant trace excerpts, and keep live invocation separate from local analysis or tests with mocked providers.
