const CONTROL_SEQUENCE_PATTERN =
  // eslint-disable-next-line no-control-regex
  /(?:\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[\x50\x5e\x5f][\s\S]*?\x1b\\|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[ -/]*[@-~]|[\x00-\x08\x0b-\x1f\x7f-\x9f])/g;

export function stripTerminalControlSequences(value: string): string {
  return value.replace(CONTROL_SEQUENCE_PATTERN, "");
}
