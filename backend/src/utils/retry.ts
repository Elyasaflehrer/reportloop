export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts: number; delayMs: number }
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt < opts.attempts) {
        await new Promise(resolve => setTimeout(resolve, opts.delayMs * attempt))
      }
    }
  }
  throw lastError
}
