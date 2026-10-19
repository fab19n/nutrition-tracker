/**
 * Persistent storage for the local-first data (IndexedDB, ARCHITECTURE.md §6).
 *
 * By default a browser may clear a site's storage under disk pressure, and Safari may clear it after
 * a stretch without use. Asking for persistent storage protects the diary. Each browser decides by
 * its own rules: Chrome and Edge answer silently (installed or often-used sites get it), Safari 17+
 * mostly grants it to an app opened from the Home Screen, Firefox may ask the person.
 *
 * Nothing here throws: unsupported browsers, insecure origins and blocked storage all come back as
 * plain values.
 */

/** What a persistence request achieved. */
export type PersistOutcome =
  /** Storage was already persistent; nothing was asked. */
  | 'persisted'
  /** The browser granted the request just now. */
  | 'granted'
  /** The browser said no (or the request failed); data stays best-effort. */
  | 'notGranted'
  /** No Storage API here (older browser, insecure origin, tests). */
  | 'unsupported';

/** Storage diagnostics for Settings or debugging. Unknown values are null. */
export interface StorageStatus {
  /** The browser can be asked for persistent storage. */
  supported: boolean;
  /** Whether storage is persistent; null when the browser can't say. */
  persisted: boolean | null;
  /** Bytes this origin uses, as estimated by the browser. */
  usageBytes: number | null;
  /** The most this origin may use, as estimated by the browser. */
  quotaBytes: number | null;
}

/** The parts of navigator.storage used here; any of them may be missing at runtime. */
export type StorageLike = Partial<Pick<StorageManager, 'persist' | 'persisted' | 'estimate'>>;

/** navigator.storage, or undefined when it's missing or reading it throws. */
function currentStorage(): StorageLike | undefined {
  try {
    if (typeof navigator === 'undefined') return undefined;
    const storage = (navigator as { storage?: StorageLike | null }).storage;
    return storage && typeof storage === 'object' ? storage : undefined;
  } catch {
    return undefined;
  }
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Asks `storage` for persistence unless it already has it. Defaults to navigator.storage.
 * Each call asks again; app code should use requestPersistentStorage().
 */
export async function persistStorage(storage: StorageLike | undefined = currentStorage()): Promise<PersistOutcome> {
  if (!storage || typeof storage.persist !== 'function') return 'unsupported';
  if (typeof storage.persisted === 'function') {
    try {
      if ((await storage.persisted()) === true) return 'persisted';
    } catch {
      // Can't tell: ask anyway.
    }
  }
  try {
    return (await storage.persist()) === true ? 'granted' : 'notGranted';
  } catch {
    return 'notGranted';
  }
}

/** One request per storage manager, so a page load asks at most once (React StrictMode included). */
const requests = new WeakMap<object, Promise<PersistOutcome>>();

/**
 * Asks the browser to keep this app's data, once per launch. Call it after the profile exists
 * (src/app/bootstrap.ts does, after setup or the demo load and on every later start). Repeat calls
 * share the first answer. A refusal is retried on the next launch, which matters on iPhone: the
 * answer from a Safari tab can be no, and the Home Screen app's yes.
 */
export function requestPersistentStorage(): Promise<PersistOutcome> {
  const storage = currentStorage();
  if (!storage) return Promise.resolve('unsupported');
  let pending = requests.get(storage);
  if (!pending) {
    pending = persistStorage(storage);
    requests.set(storage, pending);
  }
  return pending;
}

/** Whether storage is persistent and how much is used, for diagnostics. Defaults to navigator.storage. */
export async function storageStatus(storage: StorageLike | undefined = currentStorage()): Promise<StorageStatus> {
  const status: StorageStatus = {
    supported: typeof storage?.persist === 'function',
    persisted: null,
    usageBytes: null,
    quotaBytes: null,
  };
  if (!storage) return status;

  if (typeof storage.persisted === 'function') {
    try {
      const persisted: unknown = await storage.persisted();
      status.persisted = typeof persisted === 'boolean' ? persisted : null;
    } catch {
      // Unknown stays null.
    }
  }
  if (typeof storage.estimate === 'function') {
    try {
      const estimate: unknown = await storage.estimate();
      if (estimate && typeof estimate === 'object') {
        const { usage, quota } = estimate as { usage?: unknown; quota?: unknown };
        status.usageBytes = finiteOrNull(usage);
        status.quotaBytes = finiteOrNull(quota);
      }
    } catch {
      // Unknown stays null.
    }
  }
  return status;
}
