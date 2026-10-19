/** Why a cancelled estimate stopped: the signal's own reason, or a standard AbortError. */
export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The estimate was cancelled.', 'AbortError');
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}
