/** Why the AI estimate couldn't run. The service falls back to the local estimator for all of them. */
export type EstimateUnavailableReason = 'notConfigured' | 'offline' | 'timeout' | 'network' | 'http' | 'badResponse';

export class EstimateUnavailableError extends Error {
  override readonly name = 'EstimateUnavailableError';
  readonly reason: EstimateUnavailableReason;
  /** HTTP status, for reason 'http'. */
  readonly status?: number;

  constructor(reason: EstimateUnavailableReason, message: string, options: { cause?: unknown; status?: number } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.reason = reason;
    if (options.status !== undefined) this.status = options.status;
  }
}
