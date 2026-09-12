# Interface Design

Use this for read-only exploration of alternative interfaces after the user chooses a deepening candidate. Based on "Design It Twice" (Ousterhout): compare alternatives rather than treating the first idea as final. Develop designs directly; use `reader` delegates only if the user or project workflow explicitly requests delegation. Candidate selection does not authorize repository writes or implementation.

Uses the vocabulary in [LANGUAGE.md](LANGUAGE.md) — **module**, **interface**, **seam**, **adapter**, **leverage**.

## Process

### 1. Frame the problem space

Before comparing alternatives, explain the problem space for the chosen candidate in chat:

- The constraints any new interface would need to satisfy
- The dependencies it would rely on, and which category they fall into (see [DEEPENING.md](DEEPENING.md))
- A rough illustrative code sketch to ground the constraints — not a proposal, just a way to make the constraints concrete

Surface any missing material constraint before comparing designs. Keep the selected exploration read-only.

### 2. Develop alternatives

Compare materially different interfaces for the deepened module. Use the file paths, coupling details, dependency category from [DEEPENING.md](DEEPENING.md), and what sits behind the seam to ground each design. Choose useful contrasting constraints:

- Minimize the interface, aiming for 1–3 entry points and high leverage per entry point.
- Maximise flexibility for varied use cases and extension.
- Optimise for the most common caller, making the default case simple.
- Design around ports & adapters for cross-seam dependencies when applicable.

Use both [LANGUAGE.md](LANGUAGE.md) vocabulary and CONTEXT.md vocabulary. If delegation is explicitly requested, give each reader a separate technical brief and design constraint with the same read-only scope.

Each design includes:

1. Interface (types, methods, params — plus invariants, ordering, error modes)
2. Usage example showing how callers use it
3. What the implementation hides behind the seam
4. Dependency strategy and adapters (see [DEEPENING.md](DEEPENING.md))
5. Trade-offs — where leverage is high, where it's thin

### 3. Present and compare

Present designs sequentially so the user can absorb each one, then compare them in prose. Contrast by **depth** (leverage at the interface), **locality** (where change concentrates), and **seam placement**.

After comparing, recommend a design and explain why. If elements combine well, propose a hybrid. Stop when the selected design decisions are resolved or remaining uncertainties are explicit. Do not implement the design or record documentation without explicit user instruction for those changes.
