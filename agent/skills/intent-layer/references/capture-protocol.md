# Intent Layer Capture Protocol

## Capture order

Work leaf-first and clarity-first:

1. Well-understood leaf areas, such as utilities and helpers.
2. Domain-specific modules, such as auth or payments.
3. Integration layers, such as APIs and clients.
4. Complex or tangled areas, such as legacy or core logic.
5. Root and intermediate nodes after child nodes are summarized.

## SME interview questions

### Purpose and scope

- "In one sentence, what does this area own?"
- "What is explicitly not this area's responsibility?"

### Entry points

- "Where does code execution typically start in this area?"
- "What are the main APIs or interfaces other code uses?"

### Contracts and invariants

- "What must always be true here? What would break if violated?"
- "What are the implicit rules that are not obvious in the code?"

### Patterns

- "How do you add a new typical task here?"
- "What is the canonical way to do a common operation?"

### Anti-patterns

- "What mistakes do new engineers or agents typically make here?"
- "What should never be done, even if the code allows it?"

### Pitfalls

- "What is the most surprising thing about this code?"
- "What looks deprecated but is not?"

## Summarization rules

When creating parent nodes:

1. Summarize child nodes, not raw code. Children are already compressed.
2. Use the lowest common ancestor for shared facts. If a rule applies to multiple children, move it up.
3. Add cross-cutting context that explains how children relate.

## Quality checklist

Before finalizing a node:

- [ ] Node is under 4k tokens.
- [ ] Purpose statement appears in the first two lines.
- [ ] Contracts are explicit, not vague warnings like "handle carefully".
- [ ] Anti-patterns come from real experience, not hypotheticals.
- [ ] Downlinks use relative paths.
- [ ] Content does not duplicate ancestor nodes.

## Example capture

```text
Q: "What does this area own?"
A: "Payment processing. We handle the lifecycle from initiation to settlement.
   Billing is separate; they handle invoicing."

Purpose: Owns payment lifecycle: initiation -> validation -> processing -> settlement.
Does NOT own invoicing; see billing-service.

Q: "What invariants must never be violated?"
A: "Every payment mutation needs an idempotency key. We had an incident where
   a retry created duplicate charges."

Contract: Idempotency keys are required for all mutations and enforced by ProcessorClient.
```
