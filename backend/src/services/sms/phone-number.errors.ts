export class ProvisionLimitError extends Error {
  readonly code = 'PHONE_LIMIT_REACHED'
  constructor() {
    super('Phone number provisioning limit reached')
    this.name = 'ProvisionLimitError'
  }
}

export class ProvisionFailedError extends Error {
  readonly code = 'PROVISION_FAILED'
  constructor(cause?: unknown) {
    super('Failed to provision phone number')
    this.name = 'ProvisionFailedError'
    if (cause) this.cause = cause
  }
}
