import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

import * as share from '../src/lib/netdisk-share.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { NextRequest } = require('next/server');

// Execute the real service/route with isolated configuration, cache and transport.
// This avoids loading Next's application-wide database and external integrations.
function load(path, mocks = {}, fetcher = fetch) {
  const testModule = { exports: {} };
  const { outputText } = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  );
  runInNewContext(outputText, {
    module: testModule,
    exports: testModule.exports,
    require: (name) =>
      Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    fetch: fetcher,
    Response,
    Headers,
    AbortController,
    AbortSignal,
    URL,
    setTimeout,
    clearTimeout,
    Date,
    console,
  });
  return testModule.exports;
}

const sessionId = 'a'.repeat(32);
const account = { cookie: 'session=fixture', folderName: 'MoonTV在线播放' };
const sessionFixture = () => ({
  id: sessionId,
  owner: 'alice',
  provider: 'quark',
  shareId: 'abc',
  shareToken: 'share-secret-fixture',
  accountVersion: createHash('sha256').update(account.cookie).digest('hex'),
  expiresAt: Date.now() + 100000,
  files: {},
  saved: {},
  title: '电视剧',
});

function serviceFixture(session = sessionFixture()) {
  const state = {
    config: {
      NetDiskConfig: {
        enabled: true,
        playback: { enabled: true, quark: { ...account } },
      },
    },
    calls: 0,
  };
  class MockClient {
    cookie = account.cookie;
    async list() {
      state.calls++;
      return {
        hasMore: false,
        files: [
          {
            id: 'video',
            name: '第一集.mp4',
            video: true,
            directory: false,
            shareFileToken: 'file-secret-fixture',
            parentId: '0',
            size: 100,
          },
        ],
      };
    }
  }
  const service = load('../src/lib/netdisk-playback.ts', {
    '@/lib/config': { getConfig: async () => state.config },
    '@/lib/db': {
      db: { getCache: async () => session, setCache: async () => {} },
    },
    '@/lib/netdisk-share': { ...share, NetDiskShareClient: MockClient },
  });
  return { service, state, session };
}

test('playback sessions cannot be opened by another logged-in user', async () => {
  const { service, state } = serviceFixture();
  await assert.rejects(service.getNetDiskSession(sessionId, 'bob'), /无权访问/);
  assert.equal(state.calls, 0);
});

test('expired sessions and changed account authorizations are rejected', async () => {
  const { service, state, session } = serviceFixture();
  session.expiresAt = Date.now() - 1;
  await assert.rejects(service.getNetDiskSession(sessionId, 'alice'), /过期/);
  session.expiresAt = Date.now() + 10000;
  state.config.NetDiskConfig.playback.quark.cookie = 'session=replaced';
  await assert.rejects(
    service.getNetDiskSession(sessionId, 'alice'),
    /账号已更新/,
  );
});

test('only previously discovered folders and videos can be accessed', async () => {
  const { service, state } = serviceFixture();
  await assert.rejects(
    service.listNetDiskFiles(sessionId, 'alice', 'unrelated-folder', 1),
    /不在当前分享/,
  );
  await assert.rejects(
    service.prepareNetDiskVideo(sessionId, 'alice', 'arbitrary-video'),
    /当前分享/,
  );
  assert.equal(state.calls, 0);
});

test('normal users receive file names but never share or account tokens', async () => {
  const { service } = serviceFixture();
  const result = await service.listNetDiskFiles(sessionId, 'alice', '0', 1);
  assert.equal(result.files[0].name, '第一集.mp4');
  const json = JSON.stringify(result);
  assert.equal(json.includes('file-secret-fixture'), false);
  assert.equal(json.includes('share-secret-fixture'), false);
  assert.equal(json.includes('session=fixture'), false);
  const capabilities = await service.netDiskCapabilities();
  assert.equal(capabilities.quark, true);
  assert.equal(capabilities.uc, false);
});

test('invalid Cookie headers and path traversal in save-directory names are rejected', () => {
  const { service } = serviceFixture();
  assert.throws(() =>
    service.validateNetDiskAccount({ cookie: 'a=b\r\nX-Evil: 1' }),
  );
  assert.throws(() =>
    service.validateNetDiskAccount({
      cookie: 'a=b',
      folderName: '../personal',
    }),
  );
  assert.throws(() =>
    service.validateNetDiskAccount({ cookie: 'a=b', folderName: 123 }),
  );
});

function streamFixture(
  fetcher,
  owner = 'alice',
  initialUrl = 'https://pds.quark.cn/video.mp4',
) {
  const checks = [];
  const route = load(
    '../src/app/api/netdisk/stream/route.ts',
    {
      '@/lib/auth': {
        getAuthInfoFromCookie: () => (owner ? { username: owner } : null),
      },
      '@/lib/netdisk-playback': {
        getNetDiskSession: async () => ({
          session: {
            provider: 'quark',
            saved: { video: 'saved-video' },
            files: { video: { video: true } },
          },
          client: {
            cookie: 'account-cookie-fixture',
            referer: 'https://pan.quark.cn/',
            download: async () => initialUrl,
          },
        }),
      },
      '@/lib/netdisk-share': share,
      '@/lib/proxy-security': {
        validateProxyTargetUrl: async (url) => {
          checks.push(url);
          if (new URL(url).hostname === '127.0.0.1')
            throw new Error('private address');
          return url;
        },
      },
    },
    fetcher,
  );
  const request = (method = 'GET') =>
    new NextRequest(
      `http://localhost/api/netdisk/stream?session=${sessionId}&file=video`,
      {
        method,
        headers: { Range: 'bytes=0-99', Cookie: 'browser-login-fixture' },
      },
    );
  return { route, request, checks };
}

test('video proxy supports Range and 206 without forwarding browser login cookies', async () => {
  const { route, request } = streamFixture(async (_url, options) => {
    assert.equal(options.headers.get('Range'), 'bytes=0-99');
    assert.equal(options.headers.get('Cookie'), 'account-cookie-fixture');
    return new Response('video', {
      status: 206,
      headers: {
        'Content-Range': 'bytes 0-99/1000',
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Set-Cookie': 'must-not-leak',
      },
    });
  });
  const response = await route.GET(request());
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 0-99/1000');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(await response.text(), 'video');
});

test('redirects to third-party CDN never receive account cookies', async () => {
  let calls = 0;
  const { route, request, checks } = streamFixture(async (_url, options) => {
    if (calls++ === 0)
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://public-cdn.example/video.mp4' },
      });
    assert.equal(options.headers.get('cookie'), null);
    return new Response('video');
  });
  assert.equal((await route.GET(request())).status, 200);
  assert.equal(checks.length, 2);
});

test('every redirect is revalidated and private-address redirects are stopped', async () => {
  let calls = 0;
  const { route, request, checks } = streamFixture(async () => {
    calls++;
    return new Response(null, {
      status: 302,
      headers: { Location: 'http://127.0.0.1/secret' },
    });
  });
  assert.equal((await route.GET(request())).status, 502);
  assert.equal(calls, 1);
  assert.equal(checks.length, 2);
});

test('HEAD returns media metadata without a response body', async () => {
  const { route, request } = streamFixture(async (_url, options) => {
    assert.equal(options.method, 'HEAD');
    return new Response(null, {
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': '1000' },
    });
  });
  const response = await route.HEAD(request('HEAD'));
  assert.equal(response.headers.get('content-length'), '1000');
  assert.equal(response.body, null);
});

test('unauthenticated requests are rejected before contacting a netdisk', async () => {
  const { route, request } = streamFixture(async () => {
    throw new Error('must not fetch');
  }, '');
  assert.equal((await route.GET(request())).status, 401);
});

test('upstream failures do not expose signed URLs or account secrets', async () => {
  const { route, request } = streamFixture(
    async () => new Response('sensitive-upstream-response', { status: 403 }),
  );
  const response = await route.GET(request());
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.equal(body.includes('sensitive-upstream'), false);
  assert.equal(body.includes('account-cookie'), false);
  assert.equal(body.includes('https://'), false);
});
