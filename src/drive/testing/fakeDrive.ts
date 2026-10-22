/**
 * Google Drive in memory, behind a fetch, for tests: it serves exactly the requests ../api.ts
 * makes on DRIVE_API (anything else throws, so drift fails loudly), checks the
 * Bearer token, parses the two query shapes and the multipart upload, and keeps each file's
 * parents, appProperties, trashed flag and created time. Test-only; never imported by the app.
 */
import { DRIVE_API } from '../config';

export interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  trashed: boolean;
  createdTime: string;
  bytes?: Uint8Array;
}

export interface FakeDriveCall {
  method: string;
  path: string;
  query: Record<string, string>;
}

type Reply = { status: number; reason?: string } | 'network';

interface Failure {
  method?: string;
  path?: RegExp;
  reply: Reply;
  times: number;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FOLDER_QUERY = "mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='kiraMakan' and value='photos' } and trashed = false";
const PHOTO_QUERY = /^appProperties has \{ key='kmPhoto' and value='((?:[^'\\]|\\.)*)' \} and trashed = false$/;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=UTF-8' } });
}

function errorResponse(status: number, reason?: string): Response {
  return jsonResponse(status, { error: { code: status, message: reason ?? 'error', errors: reason ? [{ reason }] : [], status: 'ERROR' } });
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

async function bytesOf(body: BodyInit | null | undefined): Promise<Uint8Array> {
  if (body === undefined || body === null) return new Uint8Array();
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (typeof (body as Blob).arrayBuffer === 'function') return new Uint8Array(await (body as Blob).arrayBuffer());
  throw new Error('fakeDrive: a body it cannot read');
}

/** Bytes as a string of char codes 0–255, so binary parts can be found by index. */
function binary(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

/** The two parts of a multipart/related upload: the metadata JSON and the file bytes with its type. */
function parseMultipart(bytes: Uint8Array, boundary: string): { metadata: Record<string, unknown>; mimeType: string; data: Uint8Array } {
  const text = binary(bytes);
  const delimiter = `--${boundary}`;
  const first = text.indexOf(`${delimiter}\r\n`);
  const second = text.indexOf(`\r\n${delimiter}\r\n`, first);
  const end = text.indexOf(`\r\n${delimiter}--`, second + 1);
  if (first !== 0 || second < 0 || end < 0) throw new Error('fakeDrive: a malformed multipart body');

  const part = (from: number, to: number) => {
    const raw = text.slice(from, to);
    const split = raw.indexOf('\r\n\r\n');
    if (split < 0) throw new Error('fakeDrive: a multipart part without headers');
    const headers = raw.slice(0, split);
    const type = /^Content-Type: (.+)$/im.exec(headers)?.[1]?.trim() ?? '';
    return { type, bodyStart: from + split + 4, bodyEnd: to };
  };
  const meta = part(first + delimiter.length + 2, second);
  const file = part(second + delimiter.length + 4, end);
  if (meta.type !== 'application/json; charset=UTF-8') throw new Error(`fakeDrive: metadata typed ${meta.type}`);
  const metadata: unknown = JSON.parse(new TextDecoder().decode(bytes.slice(meta.bodyStart, meta.bodyEnd)));
  if (typeof metadata !== 'object' || metadata === null) throw new Error('fakeDrive: metadata is not an object');
  return { metadata: metadata as Record<string, unknown>, mimeType: file.type, data: bytes.slice(file.bodyStart, file.bodyEnd) };
}

function unescapeQuery(value: string): string {
  return value.replace(/\\(.)/g, '$1');
}

export function createFakeDrive(options: { clock?: () => number; email?: string } = {}) {
  const clock = options.clock ?? (() => Date.now());
  const files = new Map<string, FakeFile>();
  const calls: FakeDriveCall[] = [];
  const tokens = new Set<string>(['token-1']);
  const failures: Failure[] = [];
  let seq = 0;

  const drive = {
    files,
    calls,
    tokens,
    email: options.email ?? 'you@example.com',
    /** Runs before each request is served (after it is logged): throw to fail it, return a promise to hold it. */
    onCall: undefined as ((call: FakeDriveCall, signal: AbortSignal | undefined) => void | Promise<void>) | undefined,

    /** The next `times` requests that match get this answer instead. */
    fail(match: { method?: string; path?: RegExp }, reply: Reply, times = 1): void {
      failures.push({ ...match, reply, times });
    },

    /** A Kira Makan photos folder, as another device would have made it. */
    addFolder(createdTime: string, extra: Partial<FakeFile> = {}): FakeFile {
      const folder: FakeFile = {
        id: nextId('folder'),
        name: 'Kira Makan photos',
        mimeType: FOLDER_MIME,
        parents: [],
        appProperties: { kiraMakan: 'photos' },
        trashed: false,
        createdTime,
        ...extra,
      };
      files.set(folder.id, folder);
      return folder;
    },

    /** The photos (not folders) in the drive. */
    photos(): FakeFile[] {
      return [...files.values()].filter((f) => f.mimeType !== FOLDER_MIME);
    },

    folders(): FakeFile[] {
      return [...files.values()].filter((f) => f.mimeType === FOLDER_MIME);
    },

    /** Calls other than the token check: what the app asked Drive for. */
    requests(method?: string): FakeDriveCall[] {
      return method ? calls.filter((c) => c.method === method) : calls;
    },

    fetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => serve(input, init)) as typeof fetch,
  };

  function nextId(kind: string): string {
    seq += 1;
    return `fake${kind}${String(seq).padStart(6, '0')}`;
  }

  function takeFailure(call: FakeDriveCall): Reply | undefined {
    const found = failures.find((f) => f.times > 0 && (!f.method || f.method === call.method) && (!f.path || f.path.test(call.path)));
    if (!found) return undefined;
    found.times -= 1;
    return found.reply;
  }

  async function serve(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== DRIVE_API) throw new Error(`fakeDrive: a request to ${url.origin}`);
    const method = (init.method ?? 'GET').toUpperCase();
    const query = Object.fromEntries(url.searchParams);
    const call: FakeDriveCall = { method, path: url.pathname, query };
    calls.push(call);
    const signal = init.signal ?? undefined;
    if (signal?.aborted) throw abortError();
    await drive.onCall?.(call, signal);
    if (signal?.aborted) throw abortError();

    const failure = takeFailure(call);
    if (failure === 'network') throw new TypeError('Failed to fetch');
    if (failure) return errorResponse(failure.status, failure.reason);

    const headers = new Headers(init.headers);
    const auth = /^Bearer (.+)$/.exec(headers.get('Authorization') ?? '')?.[1];
    if (!auth || !tokens.has(auth)) return errorResponse(401, 'authError');

    const fileMatch = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (method === 'GET' && url.pathname === '/drive/v3/about') {
      if (query.fields !== 'user(emailAddress)') throw new Error(`fakeDrive: about fields ${query.fields}`);
      return jsonResponse(200, { user: { emailAddress: drive.email } });
    }
    if (method === 'GET' && url.pathname === '/drive/v3/files') return list(query);
    if (method === 'POST' && url.pathname === '/drive/v3/files') return createFolder(query, await bytesOf(init.body));
    if (method === 'POST' && url.pathname === '/upload/drive/v3/files') return upload(query, headers, await bytesOf(init.body));
    if (method === 'PATCH' && fileMatch?.[1]) return patch(decodeURIComponent(fileMatch[1]), query, await bytesOf(init.body));
    if (method === 'GET' && fileMatch?.[1]) return media(decodeURIComponent(fileMatch[1]), query);
    throw new Error(`fakeDrive: ${method} ${url.pathname} isn't a Drive call the app makes`);
  }

  function list(query: Record<string, string>): Response {
    if (query.spaces !== 'drive') throw new Error('fakeDrive: a list outside My Drive');
    const pageSize = Number(query.pageSize);
    if (query.q === FOLDER_QUERY) {
      if (query.fields !== 'files(id,createdTime)' || pageSize !== 10) throw new Error('fakeDrive: folder list fields');
      const found = [...files.values()].filter((f) => f.mimeType === FOLDER_MIME && f.appProperties.kiraMakan === 'photos' && !f.trashed);
      return jsonResponse(200, { files: found.slice(0, pageSize).map((f) => ({ id: f.id, createdTime: f.createdTime })) });
    }
    const photo = PHOTO_QUERY.exec(query.q ?? '');
    if (photo?.[1] !== undefined) {
      if (query.fields !== 'files(id)' || pageSize !== 1) throw new Error('fakeDrive: photo list fields');
      const photoId = unescapeQuery(photo[1]);
      const found = [...files.values()].filter((f) => f.appProperties.kmPhoto === photoId && !f.trashed);
      return jsonResponse(200, { files: found.slice(0, pageSize).map((f) => ({ id: f.id })) });
    }
    throw new Error(`fakeDrive: a query it doesn't know: ${query.q}`);
  }

  function createFolder(query: Record<string, string>, body: Uint8Array): Response {
    if (query.fields !== 'id') throw new Error('fakeDrive: create fields');
    const metadata = JSON.parse(new TextDecoder().decode(body)) as Partial<FakeFile>;
    if (metadata.mimeType !== FOLDER_MIME) throw new Error('fakeDrive: the app only creates folders this way');
    const folder = drive.addFolder(new Date(clock()).toISOString(), {
      name: String(metadata.name),
      appProperties: { ...(metadata.appProperties ?? {}) },
    });
    return jsonResponse(200, { id: folder.id });
  }

  function upload(query: Record<string, string>, headers: Headers, body: Uint8Array): Response {
    if (query.uploadType !== 'multipart' || query.fields !== 'id') throw new Error('fakeDrive: upload query');
    const boundary = /^multipart\/related; boundary=(km-[A-Za-z0-9]+)$/.exec(headers.get('Content-Type') ?? '')?.[1];
    if (!boundary) throw new Error(`fakeDrive: upload typed ${headers.get('Content-Type')}`);
    const { metadata, mimeType, data } = parseMultipart(body, boundary);
    const parents = Array.isArray(metadata.parents) ? metadata.parents.map(String) : [];
    const parent = parents[0] ? files.get(parents[0]) : undefined;
    if (!parent) return errorResponse(404, 'notFound');
    if (metadata.mimeType !== mimeType) throw new Error('fakeDrive: the metadata and the part disagree on the type');
    const file: FakeFile = {
      id: nextId('file'),
      name: String(metadata.name),
      mimeType,
      parents,
      appProperties: { ...((metadata.appProperties as Record<string, string> | undefined) ?? {}) },
      trashed: false,
      createdTime: new Date(clock()).toISOString(),
      bytes: data,
    };
    files.set(file.id, file);
    return jsonResponse(200, { id: file.id });
  }

  function patch(id: string, query: Record<string, string>, body: Uint8Array): Response {
    if (query.fields !== 'id') throw new Error('fakeDrive: patch fields');
    const file = files.get(id);
    if (!file) return errorResponse(404, 'notFound');
    const change = JSON.parse(new TextDecoder().decode(body)) as { trashed?: unknown };
    if (typeof change.trashed !== 'boolean' || Object.keys(change).length !== 1) throw new Error('fakeDrive: the app only patches trashed');
    file.trashed = change.trashed;
    return jsonResponse(200, { id });
  }

  function media(id: string, query: Record<string, string>): Response {
    if (query.alt !== 'media') throw new Error('fakeDrive: a file get without alt=media');
    const file = files.get(id);
    if (!file || file.mimeType === FOLDER_MIME) return errorResponse(404, 'notFound');
    const body = new Uint8Array(file.bytes ?? []);
    return new Response(body.buffer, { status: 200, headers: { 'Content-Type': file.mimeType } });
  }

  return drive;
}

export type FakeDrive = ReturnType<typeof createFakeDrive>;
