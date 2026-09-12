# Session Handoff Skill

Use [SKILL.md](SKILL.md) for the create and resume routes and their authorization boundaries.

- Create a project-local handoff when the user asks to save, pause, or transfer context.
- Load or verify a handoff when the user asks to resume from it or check it.
- Substantial work, edit counts, milestones, context pressure, and session endings alone do not trigger handoff suggestions or creation.
- A handoff is context, not authority. Loading it does not authorize code changes or execution of pending steps.

Runtime details:

- [Commands, project-root resolution, naming, chaining, validation, and staleness](references/runtime.md)
- [Handoff template](references/handoff-template.md)
- [Read-only resume checklist](references/resume-checklist.md)

Evaluation resources describe opt-in tests, not automatic runtime actions:

- [Test scenarios](evals/test-scenarios.md)
- [Capability-tier expectations](evals/model-expectations.md)
- [Historical baseline](evals/results-high-capability-baseline.md)
