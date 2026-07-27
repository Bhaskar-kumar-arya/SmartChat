export class KernelError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly permission?: string
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

export class KernelPermissionError extends KernelError {
  constructor(message: string, permission?: string) {
    super('PERMISSION_DENIED', message, permission)
  }
}

export class KernelNotFoundError extends KernelError {
  constructor(message: string) {
    super('NOT_FOUND', message)
  }
}
