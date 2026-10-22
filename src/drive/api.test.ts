// @vitest-environment node
import { createDriveApi, DriveError, toDriveError, type DriveErrorKind } from './api';
import { createFakeDrive, type FakeDrive } from './testing/fakeDrive';

const TOKEN = 'token-1';
const FOLDER_Q = "mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='kiraMakan' and value='photos' } and trashed = false";

let drive: FakeDrive;
let requests: { url: string; init: RequestInit }[];
let api: ReturnType<typeof createDriveApi>;

beforeEach(() => {
  drive = createFakeDrive({ clock: () => Date.parse('2026-10-16T11:10:00.000Z') });
  requests = [];
  api = createDriveApi(async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} });
    return drive.fetch(input, init);
  });
});

function last() {
  const request = requests.at(-1);
  if (!request) throw new Error('No request');
  return { ...request, url: new URL(request.url), headers: new Headers(request.init.headers) };
}

async function kindOf(promise: Promise<unknown>): Promise<DriveErrorKind> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DriveError) return error.kind;
    throw error;
  }
  throw new Error('It resolved');
}

describe('requests', () => {
  it('asks about.get for the email', async () => {
    expect(await api.aboutEmail(TOKEN)).toBe('you@example.com');
    const { url, init, headers } = last();
    expect(init.method).toBe('GET');
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/drive/v3/about');
    expect(url.searchParams.get('fields')).toBe('user(emailAddress)');
    expect(headers.get('Authorization')).toBe('Bearer token-1');
  });

  it('creates the folder with its marker, and finds it', async () => {
    const id = await api.createFolder(TOKEN);
    const { url, init, headers } = last();
    expect(init.method).toBe('POST');
    expect(url.pathname).toBe('/drive/v3/files');
    expect(url.searchParams.get('fields')).toBe('id');
    expect(headers.get('Content-Type')).toBe('application/json; charset=UTF-8');
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Kira Makan photos',
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { kiraMakan: 'photos' },
    });

    expect(await api.findFolders(TOKEN)).toEqual([{ id, createdTime: '2026-10-16T11:10:00.000Z' }]);
    const list = last().url.searchParams;
    expect(Object.fromEntries(list)).toEqual({ q: FOLDER_Q, spaces: 'drive', pageSize: '10', fields: 'files(id,createdTime)' });

    drive.files.get(id)!.trashed = true;
    expect(await api.findFolders(TOKEN)).toEqual([]);
  });

  it('uploads one multipart body: the metadata, then the photo with its type', async () => {
    const folderId = await api.createFolder(TOKEN);
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x0d, 0x0a, 0x7f])], { type: 'image/jpeg' });
    const id = await api.uploadPhoto(TOKEN, { folderId, photoId: 'p1', mealId: 'm1', name: '2026-10-16 Dinner - Nasi kandar.jpg', blob });

    const { url, init, headers } = last();
    expect(init.method).toBe('POST');
    expect(url.pathname).toBe('/upload/drive/v3/files');
    expect(Object.fromEntries(url.searchParams)).toEqual({ uploadType: 'multipart', fields: 'id' });
    const boundary = /^multipart\/related; boundary=(km-\w+)$/.exec(headers.get('Content-Type') ?? '')?.[1];
    expect(boundary).toBeDefined();
    const text = await (init.body as Blob).text();
    expect(text.startsWith(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`)).toBe(true);
    expect(text.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true);
    expect(text).toContain(`\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`);

    const file = drive.files.get(id);
    expect(file).toMatchObject({
      name: '2026-10-16 Dinner - Nasi kandar.jpg',
      mimeType: 'image/jpeg',
      parents: [folderId],
      appProperties: { kmPhoto: 'p1', kmMeal: 'm1' },
      trashed: false,
    });
    expect([...(file?.bytes ?? [])]).toEqual([0xff, 0xd8, 0xff, 0x00, 0x0d, 0x0a, 0x7f]);
  });

  it('types a photo without a type as JPEG', async () => {
    const folderId = await api.createFolder(TOKEN);
    const id = await api.uploadPhoto(TOKEN, { folderId, photoId: 'p1', mealId: 'm1', name: 'a.jpg', blob: new Blob(['x']) });
    expect(drive.files.get(id)?.mimeType).toBe('image/jpeg');
  });

  it("finds a photo by its id, escaping quotes in the query", async () => {
    const folderId = await api.createFolder(TOKEN);
    const id = await api.uploadPhoto(TOKEN, { folderId, photoId: "it's\\p1", mealId: 'm1', name: 'a.jpg', blob: new Blob(['x']) });
    expect(await api.findPhoto(TOKEN, "it's\\p1")).toBe(id);
    expect(Object.fromEntries(last().url.searchParams)).toEqual({
      q: "appProperties has { key='kmPhoto' and value='it\\'s\\\\p1' } and trashed = false",
      spaces: 'drive',
      pageSize: '1',
      fields: 'files(id)',
    });
    expect(await api.findPhoto(TOKEN, 'p2')).toBeUndefined();
  });

  it('trashes and restores a file', async () => {
    const folderId = await api.createFolder(TOKEN);
    const id = await api.uploadPhoto(TOKEN, { folderId, photoId: 'p1', mealId: 'm1', name: 'a.jpg', blob: new Blob(['x']) });
    await api.setTrashed(TOKEN, id, true);
    const { url, init } = last();
    expect(init.method).toBe('PATCH');
    expect(url.pathname).toBe(`/drive/v3/files/${id}`);
    expect(url.searchParams.get('fields')).toBe('id');
    expect(JSON.parse(String(init.body))).toEqual({ trashed: true });
    expect(drive.files.get(id)?.trashed).toBe(true);
    expect(await api.findPhoto(TOKEN, 'p1')).toBeUndefined();
    await api.setTrashed(TOKEN, id, false);
    expect(drive.files.get(id)?.trashed).toBe(false);
  });

  it('downloads the bytes', async () => {
    const folderId = await api.createFolder(TOKEN);
    const id = await api.uploadPhoto(TOKEN, { folderId, photoId: 'p1', mealId: 'm1', name: 'a.png', blob: new Blob(['png-bytes'], { type: 'image/png' }) });
    const blob = await api.download(TOKEN, id);
    expect(await blob.text()).toBe('png-bytes');
    expect(blob.type).toBe('image/png');
    expect(Object.fromEntries(last().url.searchParams)).toEqual({ alt: 'media' });
  });
});

describe('errors', () => {
  it.each<[number, string | undefined, DriveErrorKind]>([
    [401, 'authError', 'auth'],
    [403, 'storageQuotaExceeded', 'full'],
    [403, 'userRateLimitExceeded', 'rateLimited'],
    [403, 'rateLimitExceeded', 'rateLimited'],
    [429, undefined, 'rateLimited'],
    [403, 'insufficientFilePermissions', 'forbidden'],
    [404, 'notFound', 'notFound'],
    [500, undefined, 'unavailable'],
    [503, 'backendError', 'unavailable'],
    [400, 'badRequest', 'bad'],
  ])('maps %i %s to %s', async (status, reason, kind) => {
    drive.fail({ path: /about/ }, reason === undefined ? { status } : { status, reason });
    const failure = api.aboutEmail(TOKEN);
    expect(await kindOf(failure)).toBe(kind);
    await failure.catch((error: DriveError) => {
      expect(error.status).toBe(status);
    });
  });

  it('a wrong token is auth', async () => {
    expect(await kindOf(api.aboutEmail('stale'))).toBe('auth');
  });

  it('no answer is network, an abort is aborted', async () => {
    drive.fail({ method: 'GET' }, 'network');
    expect(await kindOf(api.findFolders(TOKEN))).toBe('network');

    const controller = new AbortController();
    controller.abort();
    expect(await kindOf(api.findFolders(TOKEN, controller.signal))).toBe('aborted');
  });

  it('turns thrown errors into a kind', () => {
    expect(toDriveError(new TypeError('Failed to fetch')).kind).toBe('network');
    expect(toDriveError(new DOMException('stop', 'AbortError')).kind).toBe('aborted');
    const own = new DriveError('full', 403, 'storageQuotaExceeded');
    expect(toDriveError(own)).toBe(own);
  });

  it('an upload into a folder that is gone is notFound', async () => {
    expect(await kindOf(api.uploadPhoto(TOKEN, { folderId: 'gone-folder-1', photoId: 'p1', mealId: 'm1', name: 'a.jpg', blob: new Blob(['x']) }))).toBe(
      'notFound',
    );
  });
});
