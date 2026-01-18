export type ArbeitErrorCode =
  | "NOT_INITIALIZED"
  | "TASK_NOT_FOUND"
  | "INVALID_STATUS"
  | "TASK_CREATE_FAILED"
  | "NO_CHANGES_MADE"

  export class ArbeitError extends Error {
  code: ArbeitErrorCode
  suggestions?: string[]
  constructor(code: ArbeitErrorCode, message: string, suggestions?: string[], options?: ErrorOptions) {
    super(message, options)
    this.code = code
    this.suggestions = suggestions
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function isArbeitError(err: unknown): err is ArbeitError {
  return err instanceof ArbeitError
}
