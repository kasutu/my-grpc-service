// Async helper utilities for tests

/**
 * Delay for a specified number of milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a specific condition to be met
 */
export function waitFor<T>(
  getter: () => T | undefined,
  timeoutMs: number = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const value = getter();
      if (value !== undefined) {
        clearInterval(interval);
        resolve(value);
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(interval);
        reject(new Error('Timeout waiting for condition'));
      }
    }, 50);
  });
}
