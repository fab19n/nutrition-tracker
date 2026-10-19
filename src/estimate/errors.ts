/**
 * Why the AI estimate couldn't run. The service falls back to the local estimator for all of them.
 * - notSignedIn: sign-in is configured but there's no session, or the server answered 401.
 * - forbidden: the server answered 403 (the account isn't allowed to use AI estimates).
 */
export type EstimateUnavailableReason =
  | 'notConfigured'
  | 'offline'
  | 'notSignedIn'
  | 'forbidden'
  | 'timeout'
  | 'network'
  | 'http'
  | 'badResponse';

export class EstimateUnavailableError extends Error {
  override readonly name = 'EstimateUnavailableError';
  readonly reason: EstimateUnavailableReason;
  /** HTTP status, for reasons 'http', 'notSignedIn' (401) and 'forbidden' (403) from the server. */
  readonly status?: number;

  constructor(reason: EstimateUnavailableReason, message: string, options: { cause?: unknown; status?: number } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.reason = reason;
    if (options.status !== undefined) this.status = options.status;
  }
}
