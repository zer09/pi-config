export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

export function isGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    // Permission errors do not prove the fixture process exited.
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    return true;
  }
}
