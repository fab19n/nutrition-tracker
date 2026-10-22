import { SYNC_THUMB_PREFIX } from '@/domain/photoSync';
import { LOCAL_THUMB_SIDE, makeLocalThumb, makeSyncThumb, SYNC_THUMB_MAX_CHARS, SYNC_THUMB_STEPS } from './thumb';

/** A canvas stand-in: records what is drawn and answers toDataURL with a string of the length the test picks. */
function fakeCanvases(dataUrlLengths: number[], blob: Blob | null = new Blob(['thumb'], { type: 'image/jpeg' })) {
  const canvases: { width: number; height: number; draws: unknown[][]; quality?: unknown }[] = [];
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return realCreate(tag);
    const record = { width: 0, height: 0, draws: [] as unknown[][], quality: undefined as unknown };
    canvases.push(record);
    const length = dataUrlLengths[canvases.length - 1] ?? 10;
    return {
      set width(v: number) {
        record.width = v;
      },
      get width() {
        return record.width;
      },
      set height(v: number) {
        record.height = v;
      },
      get height() {
        return record.height;
      },
      getContext: () => ({ drawImage: (...args: unknown[]) => record.draws.push(args) }),
      toDataURL: (type: string, quality: number) => {
        record.quality = quality;
        return `${type === 'image/jpeg' ? SYNC_THUMB_PREFIX : 'data:image/png;base64,'}${'A'.repeat(Math.max(0, length - SYNC_THUMB_PREFIX.length))}`;
      },
      toBlob: (callback: (b: Blob | null) => void, _type: string, quality: number) => {
        record.quality = quality;
        callback(blob);
      },
    } as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
  return canvases;
}

function stubBitmap(width: number, height: number) {
  const close = vi.fn();
  const create = vi.fn(async () => ({ width, height, close }));
  vi.stubGlobal('createImageBitmap', create);
  return { close, create };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('without a way to draw', () => {
  it('makes no synced thumb and keeps the photo as its own thumb', async () => {
    expect(typeof globalThis.createImageBitmap).toBe('undefined');
    const source = new Blob(['photo'], { type: 'image/jpeg' });
    expect(await makeSyncThumb(source)).toBeUndefined();
    expect(await makeLocalThumb(source)).toBe(source);
  });
});

describe('makeSyncThumb', () => {
  it('crops the centre square to 128 px, and the first small enough wins', async () => {
    const { close, create } = stubBitmap(1280, 960);
    const canvases = fakeCanvases([9_000]);
    const url = await makeSyncThumb(new Blob(['x']));
    expect(url?.startsWith(SYNC_THUMB_PREFIX)).toBe(true);
    expect(url).toHaveLength(9_000);
    expect(create).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: 'from-image' });
    expect(canvases).toHaveLength(1);
    expect(canvases[0]).toMatchObject({ width: 128, height: 128, quality: 0.7 });
    expect(canvases[0]?.draws[0]?.slice(1)).toEqual([160, 0, 960, 960, 0, 0, 128, 128]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('steps down when a thumb is too long', async () => {
    const { close } = stubBitmap(960, 1280);
    const canvases = fakeCanvases([SYNC_THUMB_MAX_CHARS + 1, SYNC_THUMB_MAX_CHARS]);
    const url = await makeSyncThumb(new Blob(['x']));
    expect(url).toHaveLength(SYNC_THUMB_MAX_CHARS);
    expect(canvases.map((c) => [c.width, c.quality])).toEqual([
      [128, 0.7],
      [112, 0.6],
    ]);
    expect(canvases[1]?.draws[0]?.slice(1)).toEqual([0, 160, 960, 960, 0, 0, 112, 112]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('gives up when no step fits', async () => {
    const { close } = stubBitmap(500, 500);
    const canvases = fakeCanvases([20_000, 20_000, 20_000]);
    expect(await makeSyncThumb(new Blob(['x']))).toBeUndefined();
    expect(canvases.map((c) => c.width)).toEqual(SYNC_THUMB_STEPS.map((s) => s.side));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('gives nothing when the photo cannot be decoded', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => Promise.reject(new DOMException('bad', 'InvalidStateError'))));
    expect(await makeSyncThumb(new Blob(['x']))).toBeUndefined();
  });
});

describe('makeLocalThumb', () => {
  it('draws the long side at 240 px as JPEG', async () => {
    const { close } = stubBitmap(1280, 960);
    const thumb = new Blob(['small'], { type: 'image/jpeg' });
    const canvases = fakeCanvases([], thumb);
    expect(await makeLocalThumb(new Blob(['x']))).toBe(thumb);
    expect(canvases[0]).toMatchObject({ width: LOCAL_THUMB_SIDE, height: 180, quality: 0.7 });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps the source when the canvas gives no blob', async () => {
    const { close } = stubBitmap(100, 50);
    fakeCanvases([], null);
    const source = new Blob(['x']);
    expect(await makeLocalThumb(source)).toBe(source);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
