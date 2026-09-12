---
name: firebase-security-rules-auditor
description: "Audit Cloud Firestore Security Rules for privilege escalation, ownership bypasses, create/update gaps, resource abuse, and unsafe field validation. Use for Firestore rules reviews or security assessments, not Cloud Storage rules."
---

# Cloud Firestore Security Rules Auditor

## Audit boundaries

Audit requests are read-only. Inspect rules, relevant data models, access requirements, and existing tests without editing files or hosted state. Rule modification, publication, deployment, or other Firebase mutations require explicit user instruction for each exact action. Recommendations do not authorize fixes or deployment. Never print, save, or commit credentials, tokens, private keys, or sensitive user data.

This checklist covers Cloud Firestore Security Rules, not Cloud Storage rules. Use [firebase-firestore](../firebase-firestore/SKILL.md) for explicitly requested implementation; keep a rules audit separate from rule changes.

## Review and findings

Read the [audit checklist and scoring format](references/audit-checklist.md) for the selected rules. Trace create/update paths, authority sources, intended access, field limits/types, and ownership checks. Use concrete bypass sequences and distinguish observed vulnerabilities from missing application context.

Treat a hardcoded admin email as a conditional design choice, not a global exception. Verify the application's bootstrap requirements, verified-email check, and escalation protections before accepting it.

## Completion

Return the structured JSON assessment from the reference with rule locations, evidence, and recommendations. State assumptions, untested paths, and missing requirements in the assessment. A clean result covers only the inspected scope; it is not a security guarantee. Do not create tests, modify rules, deploy, or exercise a live bypass as part of an audit-only request.

## Maintenance

For future updates, read the [Firebase skills update process](../../../docs/skills/firebase-skills-update-process.md).
