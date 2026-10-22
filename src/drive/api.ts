/**
 * Google Drive REST (v3) for meal photos (decision §10.18), over fetch: the only module that builds
 * googleapis.com URLs. Every call takes the access token from ./gis and an AbortSignal, and fails
 * with a DriveError whose kind the engine picks its retry from.
 *
 * With the drive.file scope the app sees only what it created: one "Kira Makan photos" folder
 * (marked `appProperties.kiraMakan = 'photos'`) and the photos in it (`kmPhoto`, `kmMeal`).
 */
import { DRIVE_API, DRIVE_FOLDER_NAME } from './config';

export type DriveErrorKind = 'network' | 'auth' | 'full' | 'rateLimited' | 'forbidden' | 'notFound' | 'unavailable' | 'bad' | 'aborted';

export class DriveError extends Error {
  readonly kind: DriveErrorKind;
  readonly status?: number;
  readonly reason?: string;

  constructor(kind: DriveErrorKind, status?: number, reason?: string) {
    super(reason ? `${kind}: ${reason}` : kind);
    this.name = 'DriveError';
    this.kind = kind;
    if (status !== undefined) this.status = status;
    if (reason !== undefined) this.reason = reason;
  }
}

export function isDriveError(error: unknown, kind?: DriveErrorKind): error is DriveError {
  return error instanceof DriveError && (kind === undefined || error.kind === kind);
}

/** A thrown fetch (or body read): the caller's abort, or no answer at all. */
export function toDriveError(error: unknown): DriveError {
  if (error instanceof DriveError) return error;
  const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
  return new DriveError(name === 'AbortError' ? 'aborted' : 'network');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Drive's error body: `{ error: { errors: [{ reason }], status } }`. */
function reasonOf(body: unknown): string | undefined {
  const error = isRecord(body) ? body.error : undefined;
  if (!isRecord(error)) return undefined;
  const first = Array.isArray(error.errors) ? error.errors[0] : undefined;
  if (isRecord(first) && typeof first.reason === 'string') return first.reason;
  return typeof error.status === 'string' ? error.status : undefined;
}

const RATE_LIMITS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

/**
 * 401 auth · 403 storageQuotaExceeded full · 403 rate limits and 429 rateLimited · other 403
 * forbidden · 404 notFound · 5xx unavailable · other 4xx bad.
 */
function httpError(status: number, body: unknown): DriveError {
  const reason = reasonOf(body);
  if (status === 401) return new DriveError('auth', status, reason);
  if (status === 403 && reason === 'storageQuotaExceeded') return new DriveError('full', status, reason);
  if (status === 429 || (status === 403 && reason !== undefined && RATE_LIMITS.has(reason))) return new DriveError('rateLimited', status, reason);
  if (status === 403) return new DriveError('forbidden', status, reason);
  if (status === 404) return new DriveError('notFound', status, reason);
  if (status >= 500) return new DriveError('unavailable', status, reason);
  return new DriveError('bad', status, reason);
}

/** A value inside a Drive query string: `\` and `'` escaped. */
function quoted(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FOLDER_QUERY = `mimeType = '${FOLDER_MIME}' and appProperties has { key='kiraMakan' and value='photos' } and trashed = false`;

export interface DriveFolder {
  id: string;
  createdTime: string;
}

export interface DriveApi {
  /** The connected account's email (about.get), or undefined when Drive doesn't say. */
  aboutEmail(token: string, signal?: AbortSignal): Promise<string | undefined>;
  /** Every Kira Makan photos folder not in the trash (two devices may each have made one). */
  findFolders(token: string, signal?: AbortSignal): Promise<DriveFolder[]>;
  createFolder(token: string, signal?: AbortSignal): Promise<string>;
  /** The file already uploaded for this photo, if any (so a retry never uploads twice). */
  findPhoto(token: string, photoId: string, signal?: AbortSignal): Promise<string | undefined>;
  uploadPhoto(token: string, input: { folderId: string; photoId: string; mealId: string; name: string; blob: Blob }, signal?: AbortSignal): Promise<string>;
  setTrashed(token: string, fileId: string, trashed: boolean, signal?: AbortSignal): Promise<void>;
  download(token: string, fileId: string, signal?: AbortSignal): Promise<Blob>;
}

/** `fetchImpl` defaults to globalThis.fetch, read at call time. */
export function createDriveApi(fetchImpl?: typeof fetch): DriveApi {
  function url(path: string, query: Record<string, string> = {}): string {
    const target = new URL(path, DRIVE_API);
    for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
    return target.toString();
  }

  async function send(target: string, token: string, init: RequestInit, signal: AbortSignal | undefined): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    let response: Response;
    try {
      response = await (fetchImpl ?? globalThis.fetch)(target, { ...init, headers, ...(signal ? { signal } : {}) });
    } catch (error) {
      throw toDriveError(error);
    }
    if (response.ok) return response;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    throw httpError(response.status, body);
  }

  async function json(target: string, token: string, init: RequestInit, signal: AbortSignal | undefined): Promise<Record<string, unknown>> {
    const response = await send(target, token, init, signal);
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      const failure = toDriveError(error);
      throw failure.kind === 'aborted' ? failure : new DriveError('bad', response.status, 'The answer was not JSON');
    }
    if (!isRecord(body)) throw new DriveError('bad', response.status, 'The answer was not an object');
    return body;
  }

  function idOf(body: Record<string, unknown>, status = 200): string {
    if (typeof body.id !== 'string' || body.id === '') throw new DriveError('bad', status, 'The answer had no id');
    return body.id;
  }

  const jsonHeaders = { 'Content-Type': 'application/json; charset=UTF-8' };

  return {
    async aboutEmail(token, signal) {
      const body = await json(url('/drive/v3/about', { fields: 'user(emailAddress)' }), token, { method: 'GET' }, signal);
      const user = body.user;
      return isRecord(user) && typeof user.emailAddress === 'string' && user.emailAddress !== '' ? user.emailAddress : undefined;
    },

    async findFolders(token, signal) {
      const query = { q: FOLDER_QUERY, spaces: 'drive', pageSize: '10', fields: 'files(id,createdTime)' };
      const body = await json(url('/drive/v3/files', query), token, { method: 'GET' }, signal);
      const files = Array.isArray(body.files) ? body.files : [];
      return files.flatMap((file): DriveFolder[] =>
        isRecord(file) && typeof file.id === 'string' ? [{ id: file.id, createdTime: typeof file.createdTime === 'string' ? file.createdTime : '' }] : [],
      );
    },

    async createFolder(token, signal) {
      const metadata = { name: DRIVE_FOLDER_NAME, mimeType: FOLDER_MIME, appProperties: { kiraMakan: 'photos' } };
      const body = await json(url('/drive/v3/files', { fields: 'id' }), token, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(metadata) }, signal);
      return idOf(body);
    },

    async findPhoto(token, photoId, signal) {
      const q = `appProperties has { key='kmPhoto' and value=${quoted(photoId)} } and trashed = false`;
      const body = await json(url('/drive/v3/files', { q, spaces: 'drive', pageSize: '1', fields: 'files(id)' }), token, { method: 'GET' }, signal);
      const first = Array.isArray(body.files) ? body.files[0] : undefined;
      return isRecord(first) && typeof first.id === 'string' ? first.id : undefined;
    },

    async uploadPhoto(token, input, signal) {
      const mimeType = input.blob.type || 'image/jpeg';
      const boundary = `km-${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
      const metadata = {
        name: input.name,
        parents: [input.folderId],
        mimeType,
        appProperties: { kmPhoto: input.photoId, kmMeal: input.mealId },
      };
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
        input.blob,
        `\r\n--${boundary}--\r\n`,
      ]);
      const answer = await json(
        url('/upload/drive/v3/files', { uploadType: 'multipart', fields: 'id' }),
        token,
        { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body },
        signal,
      );
      return idOf(answer);
    },

    async setTrashed(token, fileId, trashed, signal) {
      await json(
        url(`/drive/v3/files/${encodeURIComponent(fileId)}`, { fields: 'id' }),
        token,
        { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ trashed }) },
        signal,
      );
    },

    async download(token, fileId, signal) {
      const response = await send(url(`/drive/v3/files/${encodeURIComponent(fileId)}`, { alt: 'media' }), token, { method: 'GET' }, signal);
      try {
        return await response.blob();
      } catch (error) {
        throw toDriveError(error);
      }
    },
  };
}
