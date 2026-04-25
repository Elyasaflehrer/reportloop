import { config } from '../../config.js'

export class SmsTooLongError extends Error {
  constructor(public readonly length: number, public readonly max: number) {
    super(`SMS body is too long: ${length} chars (max ${max})`)
    this.name = 'SmsTooLongError'
  }
}

export type LengthValidationResult =
  | { ok: true;  warning: false }
  | { ok: true;  warning: true;  message: string }
  | { ok: false; length: number; max: number }

export function validateMessageLength(body: string): LengthValidationResult {
  const max    = config.sms.maxLength
  const length = body.length

  if (length > max) {
    return { ok: false, length, max }
  }

  if (length > max * 0.8) {
    return {
      ok:      true,
      warning: true,
      message: `SMS is at ${Math.round((length / max) * 100)}% of the ${max}-character limit`,
    }
  }

  return { ok: true, warning: false }
}

// Throws SmsTooLongError if the body exceeds the limit.
// Use this in the broadcast loop where a hard failure is the right behaviour.
export function assertMessageLength(body: string): void {
  const result = validateMessageLength(body)
  if (!result.ok) throw new SmsTooLongError(result.length, result.max)
}
