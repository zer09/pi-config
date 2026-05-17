# Model Capability Expectations

This document describes expected behavior differences across model capability tiers when using the session-handoff skill. It avoids tying the eval to one AI platform or model family.

## Capability Tiers

### Fast/Lightweight
- **Strengths**: Quick responses, follows explicit instructions well
- **Limitations**: May need more guidance, less proactive
- **Skill adjustments**: Use explicit prompts for complex scenarios

### Balanced
- **Strengths**: Good balance of speed and capability, handles workflows well
- **Limitations**: May occasionally miss subtle triggers
- **Skill adjustments**: Should work well with default instructions

### High-Capability
- **Strengths**: Strong context understanding, proactive suggestions
- **Limitations**: May over-elaborate when not needed
- **Skill adjustments**: Add concise scope boundaries when needed

---

## Expected Behaviors by Scenario

### Scenario 1: Basic Handoff Creation

| Aspect | Fast/Lightweight | Balanced | High-Capability |
|--------|------------------|----------|-----------------|
| Trigger recognition | Should trigger | Should trigger | Should trigger |
| Script execution | Runs script | Runs script | Runs script |
| TODO completion | May need prompting | Fills reasonable defaults | Rich, detailed content |
| Validation reminder | May skip | Usually includes | Always includes |

**Fast/Lightweight guidance:**
- May need explicit "now fill in the TODO sections"
- Keep prompts simple and direct

**High-Capability notes:**
- May proactively suggest additional sections
- May add extra context without being asked

### Scenario 2: Handoff Chaining

| Aspect | Fast/Lightweight | Balanced | High-Capability |
|--------|------------------|----------|-----------------|
| Finds previous handoffs | With explicit prompt | Usually automatic | Always automatic |
| Uses --continues-from | May need reminder | Usually correct | Always correct |
| Context from previous | Basic reference | Good summary | Detailed synthesis |

**Fast/Lightweight guidance:**
- Explicitly mention "link to the previous handoff"
- May need to specify exact filename

### Scenario 3: Resume from Handoff

| Aspect | Fast/Lightweight | Balanced | High-Capability |
|--------|------------------|----------|-----------------|
| Lists handoffs | With prompt | Automatic | Automatic |
| Staleness check | May skip | Usually runs | Always runs |
| Context absorption | Basic | Good | Excellent |
| Next steps focus | May need guidance | Usually clear | Proactive planning |

**Fast/Lightweight guidance:**
- Explicitly ask "check the staleness first"
- May need "what are the next steps from the handoff?"

### Scenario 4: Proactive Handoff Suggestion

| Aspect | Fast/Lightweight | Balanced | High-Capability |
|--------|------------------|----------|-----------------|
| Recognizes substantial work | Unlikely without prompt | Sometimes | Usually |
| Suggests handoff | Rarely proactive | Sometimes proactive | Often proactive |
| Timing of suggestion | N/A | After 5+ major items | After 3-5 items |

**Notes:**
- Fast/lightweight models will rarely proactively suggest handoffs
- Balanced models may suggest after explicit substantial work description
- High-capability models are most likely to suggest unprompted

### Scenario 5: Validation Flow

| Aspect | Fast/Lightweight | Balanced | High-Capability |
|--------|------------------|----------|-----------------|
| Runs validation script | With explicit request | Usually automatic | Always automatic |
| Interprets score | Basic | Good | Detailed |
| Actionable feedback | May need prompting | Usually provides | Detailed plan |

### Scenario 6: Staleness Check

| Aspect | Fast/Lightweight | Balanced | High-Capability |
|--------|------------------|----------|-----------------|
| Runs staleness script | With explicit request | Usually | Always |
| Interprets results | Basic | Good | Detailed analysis |
| Recommendations | Repeats script output | Contextualizes | Strategic advice |

### Scenario 7: Secret Detection

| Aspect | Fast/Lightweight | Balanced | High-Capability |
|--------|------------------|----------|-----------------|
| Detects secrets | Via script | Via script | Via script + may notice more |
| Warning clarity | Basic | Clear | Detailed security advice |
| Remediation guidance | Script output | Clear steps | Comprehensive plan |

---

## Tuning Recommendations

### For Fast/Lightweight Optimization
If the model struggles:
1. Add more explicit trigger phrases to description
2. Include step-by-step numbered instructions
3. Add explicit checkpoints, such as "After creating, run validation"
4. Reduce ambiguity in instructions

### For Balanced Optimization
If the model misses triggers:
1. Ensure key terms are in description
2. Add example trigger phrases
3. Make workflow decision points clearer

### For High-Capability Optimization
If the model over-elaborates:
1. Add "keep responses concise" guidance
2. Specify when NOT to add extra content
3. Define clear scope boundaries

---

## Pass/Fail Criteria by Capability Tier

### Minimum Pass Thresholds

| Tier | Min Score | Notes |
|------|-----------|-------|
| Fast/Lightweight | 49/70 (70%) | Allow some missed proactive triggers |
| Balanced | 56/70 (80%) | Should handle most scenarios well |
| High-Capability | 63/70 (90%) | Should excel at all scenarios |

### Critical Failures (Any Model)
These should always work regardless of model:
- [ ] Basic handoff creation with explicit request
- [ ] Script execution when instructed
- [ ] Secret detection warning
- [ ] File creation in correct location

---

## Testing Protocol

1. **Run setup script:**
   ```bash
   uv run python evals/setup_test_env.py
   cd /tmp/handoff-eval-project
   ```

2. **Test each scenario in a new conversation**
   - Start a fresh conversation for each scenario
   - Use exact trigger phrases from test-scenarios.md
   - Record scores using the results template

3. **Compare across model tiers**
   - Note significant behavior differences
   - Identify skill improvements needed
   - Update SKILL.md if fast/lightweight models need more guidance

4. **Document findings**
   - Use the results template for each model/tier
   - Note specific failure modes
   - Recommend skill adjustments
