export type SecretForRedaction = {
  label: string;
  value?: string;
};

function replacementFor(label: string): string {
  const safe = label.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
  return `[REDACTED_${safe}]`;
}

export function redactString(input: string, secrets: SecretForRedaction[]): string {
  let output = input;
  for (const secret of secrets) {
    if (!secret.value) continue;
    output = output.split(secret.value).join(replacementFor(secret.label));
  }
  return output;
}

export function redactSecrets<T>(value: T, secrets: SecretForRedaction[]): T {
  if (typeof value === "string") return redactString(value, secrets) as T;
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, secrets)) as T;
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = redactSecrets(child, secrets);
  }
  return out as T;
}
