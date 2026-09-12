# Cloud Firestore Rules Audit Checklist

Use this checklist for a read-only review of Cloud Firestore Security Rules. Do not modify rule files, deploy, or run attacks against live data. Each rule modification or hosted mutation requires explicit user instruction for that exact action. Do not include credentials or sensitive user data in findings.

## Security checks

1. **Create/update bypass:** Compare `create` and `update`. Can a user create a valid document and then change roles, ownership, size, or types into an invalid state? Trace multi-operation bypasses rather than judging each rule in isolation.
2. **Authority source:** Check whether `role`, `isAdmin`, `ownerId`, or another sensitive decision trusts user-controlled `request.resource.data`. Identify who can set or change the authority source.
3. **Application access requirements:** Compare allowed reads and writes with the app's verified purpose. For example, collaboration may require collaborator access. Report missing requirements as uncertainty rather than assuming an intended access model.
4. **Resource abuse:** Check relevant string length, array size, and other field limits. Report absent limits as resource-exhaustion/DoS risks, with the reachable operation and impact. Distinguish missing application limits from platform limits; this is Firestore document validation, not Cloud Storage object validation.
5. **Type safety:** Check field validation such as `is string`, `is int`, and `is timestamp`. Verify required and optional fields and consistency between creation and updates.
6. **Field restrictions versus identity:** `hasOnly()` and `diff()` restrict which fields change, not who changes them. Verify ownership or an appropriate ACL alongside field checks. An authenticated user updating another user's document without authority is a data-integrity vulnerability.

For each finding, identify the rule path and line, the attacker identity, prerequisites, and a concrete operation or sequence that demonstrates the gap. Do not invent test results when the assessment is static.

## Admin bootstrapping and privileges

Do not assume every app permits a hardcoded admin email. Accept that design without a scoring penalty only if all of the following are verified:

- Application requirements explicitly permit a single-email bootstrap or allowlist model.
- The rule checks `request.auth.token.email_verified == true` as well as the intended email identity.
- The identity source is trusted for the application's sign-in configuration.
- Users cannot self-assign admin status, change the authoritative allowlist, or use create/update paths to escalate privileges.

If the requirements or identity guarantees are missing, record the uncertainty and needed evidence. If a bypass exists, score the bypass by impact. A verified bootstrap exception does not excuse unrelated authorization or validation flaws.

## Score (1–5)

| Score | Meaning |
| --- | --- |
| 1: Critical | Unauthorized sensitive-data access, privilege escalation, or total validation bypass. |
| 2: Major | Broken access requirements, self-assigned roles, or substantial control bypass. |
| 3: Moderate | PII exposure or inconsistent create/update validation on critical fields. |
| 4: Minor | Self-data corruption, missing field limits or minor type checks, or overly broad access to non-sensitive data. |
| 5: No findings in reviewed scope | Relevant validation, ownership, and role/ACL checks hold for the inspected paths. This is not proof that all paths are secure. |

Score by reachable impact and application context. Explain scope limits in `summary`; do not turn missing evidence into a claim of safety.

## Structured assessment

Return JSON with `score`, `summary`, and `findings`. Each finding includes `check`, `severity`, `issue`, and `recommendation`; include the rule location and concrete bypass evidence in `issue`. Severity is `critical`, `major`, `moderate`, or `minor`. Use an empty findings array when no issue is found and state the review limits.

Example shape, not a finding about the current application:

```json
{
  "score": 3,
  "summary": "Static review of the supplied rules; application access requirements remain unverified.",
  "findings": [
    {
      "check": "Create/update bypass",
      "severity": "moderate",
      "issue": "At the identified rule path and line, an allowed update omits validation enforced at creation. Describe the reachable field change and impact here.",
      "recommendation": "Apply the relevant field validation to updates alongside the existing identity check."
    }
  ]
}
```
