export type ArbeitErrorCode =
  | "NOT_INITIALIZED"
  | "TASK_NOT_FOUND"
  | "INVALID_STATUS"
  | "TASK_CREATE_FAILED"
  | "TASK_UPDATE_FAILED"
  | "NO_CHANGES_MADE"
  | "HAS_CHILDREN"
  | "HAS_BLOCKERS"
  | "TASK_DELETE_FAILED"
  | "ALREADY_WORKING"
  | "NOT_WORKING_ON_TASK"
  | "TASK_NOT_ACTIVE"
  | "RELATIONSHIP_CREATE_FAILED"
  | "INVALID_TYPE"
  | "INVALID_TEMPLATE"
  | "RELATIONSHIP_EXISTS"
  | "CIRCULAR_DEPENDENCY"
  | "MAX_DEPTH_EXCEEDED"
  | "PARENT_NOT_FOUND"
  | "ENTRY_NOT_FOUND"
  | "ITEM_NOT_FOUND"
  | "BLOCKER_NOT_FOUND"
  | "INVALID_BLOCKER"
  | "DUPLICATE_BLOCKERS"
  | "ALREADY_SUPERSEDED"
  | "CONTEXT_CREATE_FAILED"
  | "CONTEXT_SUPERSEDE_FAILED"

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
