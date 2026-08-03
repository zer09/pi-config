# Delegated Pi prompt and spawn contracts

Load this reference before spawning delegates. Adapt project paths, documents, role templates, finding taxonomies, and gates without weakening the isolation and mutation rules.

## Read-only tree fingerprint

Capture before and after every reviewer or verifier:

```bash
project_root="${PROJECT_ROOT:?set PROJECT_ROOT to the reviewed project root}"
cd "$project_root"
printf '%s\n' 'status:'
git status --short
printf 'unstaged='; git diff --binary | sha256sum
printf 'staged='; git diff --cached --binary | sha256sum
```

The status plus hashes distinguish pre-existing tracked/staged content from delegate mutation without dumping the diff. If existing untracked files are in review scope, also capture their content hashes with a path-safe method that does not follow symlinks. If the project is not a Git repository, record an equivalent bounded manifest for the relevant files. Do not create snapshots inside the project.

## Spawn commands

Set the project and temporary prompt paths in the parent session. Run these with direct `bash`. Omit the bash tool's timeout field entirely.

### Implementation or focused remediation

```bash
project_root="${PROJECT_ROOT:?set PROJECT_ROOT to the delegated project root}"
prompt_file="${TMPDIR:-/tmp}/project-implementation-prompt.md"
cd "$project_root"
PI_SKIP_VERSION_CHECK=1 pi \
  --print \
  --no-session \
  --approve \
  --provider openai-codex \
  --model gpt-5.6-luna \
  --thinking max \
  @"$prompt_file"
```

### Independent review or finding verification

```bash
project_root="${PROJECT_ROOT:?set PROJECT_ROOT to the delegated project root}"
prompt_file="${TMPDIR:-/tmp}/project-review-prompt.md"
cd "$project_root"
PI_SKIP_VERSION_CHECK=1 pi \
  --print \
  --no-session \
  --approve \
  --provider openai-codex \
  --model gpt-5.6-sol \
  --thinking high \
  @"$prompt_file"
```

`PI_SKIP_VERSION_CHECK=1` suppresses Pi's version-check request; it does not disable the selected provider request. Do not use `PI_OFFLINE=1` for a provider-backed delegate.

## Common delegate header

Every role prompt should establish:

```markdown
# Task: <project and exact role>

You are a fresh delegated Pi instance working directly in `<project-root>`.

Execute this assigned role yourself. Do not spawn or orchestrate another Pi instance.
Read all required context and project instructions before acting. More-specific project instructions win.
The working tree may contain user-owned changes. Do not reset, clean, stash, overwrite, or revert them.
Do not stage, commit, push, or mutate hosted services unless this prompt explicitly authorizes that exact action.
```

Use actual safe paths in the generated temporary prompt. Do not retain generic angle-bracket placeholders.

## Implementation prompt contract

Include:

1. **Objective** — one narrow implementation outcome.
2. **Exact scope** — files/areas expected to change and explicitly deferred work.
3. **Binding reading** — project instructions, plans, architecture, ADRs, review reports, and ledgers.
4. **Invariants** — behaviors that must remain true.
5. **Concrete defect mechanics** — exact race, interleaving, durable state, error, or user-visible consequence when fixing a finding.
6. **Success criteria** — regression tests, behavior, documentation, and gates.
7. **Prohibitions** — no broad review, unrelated cleanup, recursive delegation, Git transitions, or hosted-service mutation.
8. **Report** — changed paths, implementation summary, tests with exact commands/results, and remaining risks.

Require the implementation delegate to update project review/remediation documentation when the project workflow requires it. Self-reported tests do not count as independent approval.

## Independent-review prompt contract

Keep the reviewer neutral. Include only information required to locate and judge the candidate:

1. Exact base/head or working-tree scope.
2. Complete governing documents and accepted decisions.
3. Required implementation and release invariants.
4. Explicitly deferred scope.
5. Required review gates and whether tests may be run.
6. Read-only and non-recursive-delegation prohibitions.
7. Structured output contract.

Do **not** include:

- expected findings;
- remediation rationale;
- statements that the tree should pass;
- a summary that hides the governing source documents;
- prior reviewer conclusions when the workflow requires context isolation.

Recommended output:

```markdown
# Verdict
PASS | PASS WITH REQUIRED FIXES | CHANGES REQUESTED

# Findings
## <stable ID>: <title>
- Severity:
- Location:
- Evidence:
- Reproduction/interleaving:
- Impact:
- Required contract:
- Suggested validation:

# Gate evidence
- <command>: <result>

# Deferred scope and limits
- ...
```

A no-findings review should say so explicitly and still report gate evidence and limits.

## Finding-verification prompt contract

Give the verifier:

1. The complete independent finding verbatim.
2. Exact tree/base under verification.
3. Governing architecture and decision documents.
4. A strict verification-only scope.
5. Permission to run bounded diagnostics/tests but not edit files.
6. The project's classification taxonomy.

Require evidence for control flow, realistic reproduction, impact, existing coverage, and whether the required contract follows from accepted architecture. The verifier must not fix the issue, conduct a new broad review, or optimize for agreement with the reviewer.

Recommended output:

```markdown
# Classification
REPRODUCED | PARTIALLY REPRODUCED | NOT REPRODUCED | ALREADY FIXED | DUPLICATE | ARCHITECTURE AMBIGUITY

# Evidence
- ...

# Exact remediation contract
- Required only when reproduced or partially reproduced.

# Limits
- ...
```

## Focused-remediation prompt contract

Give the remediator:

1. The complete original finding.
2. The complete independent verification report.
3. Exact scope and binding documents.
4. The smallest acceptable behavioral contract.
5. Required failing regression and targeted/full gates.
6. Required ledger/review-document updates.
7. Explicit prohibitions against broad review, unrelated cleanup, recursive delegation, and unauthorized Git/hosted-service changes.

Require tests before or alongside behavior. The regression should fail for the verified reason and pass because of the fix, not because expectations were weakened.

## Handoff preservation

Store generated role prompts and complete delegate reports under `${TMPDIR:-/tmp}` or another explicitly temporary location outside the tracked project. Use stable round/finding identifiers in filenames. Do not place local workflow prompts into a commit unless the project explicitly requires them to be tracked.

Before the next role begins, preserve:

- exact finding text;
- verifier classification and evidence;
- remediation scope and changed paths;
- gate commands/results;
- current tree identity and authorization state.

Do not pass remediation narratives into the next independent reviewer.
