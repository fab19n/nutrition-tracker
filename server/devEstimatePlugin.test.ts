// @vitest-environment node
// The Vite dev endpoint: it needs no sign-in, so it must only answer the app on its own origin.
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { EstimateError, type EstimateInput, type EstimateOutput } from '../supabase/functions/estimate/core';
import { createDevEstimateMiddleware, isAcceptedContentType, isSameOriginRequest, type DevEstimateDeps } from './devEstimatePlugin';

const OUTPUT: EstimateOutput = {
  items: [],
  questions: [],
  unmatched: [],
  method: 'ai',
  mealName: 'Nasi lemak',
  model: 'claude-sonnet-5-5',
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
};

const DEV = 'http://localhost:5173';
const SAME_ORIGIN = { host: 'localhost:5173', origin: DEV, 'sec-fetch-site': 'same-origin' };

function request(method: string, headers: IncomingHttpHeaders, body = ''): IncomingMessage {
  return Object.assign(Readable.from(body === '' ? [] : [Buffer.from(body)]), { method, headers, url: '/' }) as unknown as IncomingMessage;
}

interface Captured {
  res: ServerResponse;
  status: () => number;
  json: () => unknown;
}

function response(): Captured {
  let status = 0;
  let text = '';
  const res = {
    set statusCode(value: number) {
      status = value;
    },
    get statusCode() {
      return status;
    },
    setHeader: () => res,
    end: (chunk?: string) => {
      text = chunk ?? '';
      return res;
    },
  };
  return { res: res as unknown as ServerResponse, status: () => status, json: () => JSON.parse(text) as unknown };
}

function setup(overrides: Partial<DevEstimateDeps> = {}) {
  const estimate = vi.fn(async (_input: EstimateInput) => OUTPUT);
  const logger = { info: vi.fn(), error: vi.fn() };
  const handle = createDevEstimateMiddleware({ apiKey: 'sk-test', estimate, logger, ...overrides });
  const call = async (method: string, headers: IncomingHttpHeaders, body = '') => {
    const out = response();
    await handle(request(method, headers, body), out.res);
    return out;
  };
  return { call, estimate, logger };
}

const MEAL = '{"text":"nasi lemak"}';

describe('dev estimate endpoint', () => {
  it('refuses a text/plain POST from a foreign origin and never calls Claude', async () => {
    const { call, estimate } = setup();
    const out = await call('POST', { host: 'localhost:5173', origin: 'https://evil.example', 'content-type': 'text/plain' }, MEAL);
    expect(out.status()).toBe(403);
    expect(out.json()).toMatchObject({ code: 'forbidden' });
    expect(estimate).not.toHaveBeenCalled();
  });

  it('refuses cross-site multipart and hidden ("null") origins', async () => {
    const { call, estimate } = setup();
    const multipart = 'multipart/form-data; boundary=x';
    const crossSite = await call('POST', { host: 'localhost:5173', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': multipart });
    expect(crossSite.status()).toBe(403);
    const hidden = await call('POST', { host: 'localhost:5173', origin: 'null', 'content-type': 'application/json' }, MEAL);
    expect(hidden.status()).toBe(403);
    const siteOnly = await call('POST', { host: 'localhost:5173', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }, MEAL);
    expect(siteOnly.status()).toBe(403);
    expect(estimate).not.toHaveBeenCalled();
  });

  it('refuses another localhost port, which Vite CORS would let through', async () => {
    const { call, estimate } = setup();
    const out = await call('POST', { host: 'localhost:5173', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-site', 'content-type': 'application/json' }, MEAL);
    expect(out.status()).toBe(403);
    expect(estimate).not.toHaveBeenCalled();
  });

  it('refuses body types the app never sends, even from the app', async () => {
    const { call, estimate } = setup();
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', undefined]) {
      const headers: IncomingHttpHeaders = { ...SAME_ORIGIN };
      if (type) headers['content-type'] = type;
      expect((await call('POST', headers, MEAL)).status()).toBe(415);
    }
    expect(estimate).not.toHaveBeenCalled();
  });

  it('estimates for the app on its own origin', async () => {
    const { call, estimate, logger } = setup();
    const out = await call('POST', { ...SAME_ORIGIN, 'content-type': 'application/json' }, MEAL);
    expect(out.status()).toBe(200);
    expect(out.json()).toEqual(OUTPUT);
    expect(estimate).toHaveBeenCalledWith(expect.objectContaining({ text: 'nasi lemak' }));
    expect(logger.info).toHaveBeenCalled();
  });

  it('answers the app opened by LAN address, and local scripts without browser headers', async () => {
    const { call, estimate } = setup();
    const lan = await call('POST', { host: '192.168.1.20:5173', origin: 'http://192.168.1.20:5173', 'content-type': 'application/json; charset=utf-8' }, MEAL);
    expect(lan.status()).toBe(200);
    const script = await call('POST', { host: 'localhost:5173', 'content-type': 'application/json' }, MEAL);
    expect(script.status()).toBe(200);
    expect(estimate).toHaveBeenCalledTimes(2);
  });

  it('answers 503 without a key and 405 for other methods', async () => {
    const off = setup({ apiKey: undefined });
    const out = await off.call('POST', { ...SAME_ORIGIN, 'content-type': 'application/json' }, MEAL);
    expect(out.status()).toBe(503);
    expect(out.json()).toMatchObject({ code: 'unavailable' });
    expect((await off.call('GET', SAME_ORIGIN)).status()).toBe(405);
    expect((await off.call('OPTIONS', { host: 'localhost:5173', origin: 'https://evil.example' })).status()).toBe(405);
    expect(off.estimate).not.toHaveBeenCalled();
  });

  it('answers 400 for a body that is not JSON', async () => {
    const { call, estimate } = setup();
    const out = await call('POST', { ...SAME_ORIGIN, 'content-type': 'application/json' }, '{not json');
    expect(out.status()).toBe(400);
    expect(out.json()).toMatchObject({ code: 'bad_request' });
    expect(estimate).not.toHaveBeenCalled();
  });

  it('passes estimate errors through and hides unexpected ones', async () => {
    const refused = setup({ estimate: async () => Promise.reject(new EstimateError('Declined', 422, 'refused')) });
    const res = await refused.call('POST', { ...SAME_ORIGIN, 'content-type': 'application/json' }, MEAL);
    expect(res.status()).toBe(422);
    expect(res.json()).toEqual({ error: 'Declined', code: 'refused' });

    const broken = setup({ estimate: async () => Promise.reject(new Error('secret detail')) });
    const res2 = await broken.call('POST', { ...SAME_ORIGIN, 'content-type': 'application/json' }, MEAL);
    expect(res2.status()).toBe(500);
    expect(JSON.stringify(res2.json())).not.toContain('secret');
    expect(broken.logger.error).toHaveBeenCalled();
  });
});

describe('isSameOriginRequest', () => {
  it('compares the Origin with the Host, ignoring case and default ports', () => {
    expect(isSameOriginRequest({ host: 'LocalHost:5173', origin: DEV })).toBe(true);
    expect(isSameOriginRequest({ host: 'localhost', origin: 'http://localhost:80' })).toBe(true);
    expect(isSameOriginRequest({ host: '[::1]:5173', origin: 'http://[::1]:5173' })).toBe(true);
    expect(isSameOriginRequest({ host: '127.0.0.1:5173', origin: DEV })).toBe(false);
    expect(isSameOriginRequest({ host: 'localhost:5173', origin: 'http://localhost:5173.evil.example' })).toBe(false);
    expect(isSameOriginRequest({ host: 'localhost:5173', origin: 'file://' })).toBe(false);
    expect(isSameOriginRequest({ origin: DEV })).toBe(false);
  });

  it('trusts only same-origin fetch metadata', () => {
    expect(isSameOriginRequest({ 'sec-fetch-site': 'same-origin' })).toBe(true);
    expect(isSameOriginRequest({ 'sec-fetch-site': 'same-site' })).toBe(false);
    expect(isSameOriginRequest({ 'sec-fetch-site': 'none' })).toBe(false);
    expect(isSameOriginRequest({})).toBe(true);
  });
});

describe('isAcceptedContentType', () => {
  it('takes JSON and multipart only', () => {
    expect(isAcceptedContentType('application/json')).toBe(true);
    expect(isAcceptedContentType('Application/JSON; charset=utf-8')).toBe(true);
    expect(isAcceptedContentType('multipart/form-data; boundary=abc')).toBe(true);
    expect(isAcceptedContentType('text/plain')).toBe(false);
    expect(isAcceptedContentType('application/jsonp')).toBe(false);
    expect(isAcceptedContentType(undefined)).toBe(false);
  });
});
