export class ExtensionLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExtensionLoadError'
  }
}

export class ManifestValidationError extends ExtensionLoadError {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestValidationError'
  }
}

export class ApiVersionError extends ExtensionLoadError {
  constructor(message: string) {
    super(message)
    this.name = 'ApiVersionError'
  }
}
