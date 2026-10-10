import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { decodeHuangguoCover } from '../src/lib/huangguo-cover.ts';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');
function route({ auth = true, enabled = true, invalid = false, oversized = false } = {}) {
  const calls = [];
  const modules = {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/auth': { getAuthInfoFromCookie: () => auth ? { username: 'admin' } : null },
    '@/lib/huangguo-cover': { decodeHuangguoCover },
    '@/lib/source-script': { listEnabledSourceScripts: async () => enabled ? [{ key: 'huangguo_fongmi' }] : [] },
    '@/lib/user-agent': { DEFAULT_USER_AGENT: 'test-agent' },
    '@/lib/proxy-security': {
      fetchWithValidatedRedirects: async (url, options) => {
        calls.push({ url, options });
        if (invalid) throw new Error('Blocked target URL');
        return { ok: true };
      },
      readArrayBufferLimited: async (_, limit) => {
        assert.equal(limit, 4 * 1024 * 1024);
        if (oversized) throw new Error('Response too large');
        return png;
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/app/api/source-script/huangguo-cover/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require: name => modules[name], Response, URL, AbortSignal });
  return { calls, get: () => module.exports.GET({ url: 'https://local.test/api/source-script/huangguo-cover?url=https%3A%2F%2Fcdn.test%2Fcover.bin' }) };
}
test('unauthenticated cover requests do not fetch upstream', async () => {
  const r = route({ auth: false });
  assert.equal((await r.get()).status, 401);
  assert.equal(r.calls.length, 0);
});
test('disabled source cover requests do not fetch upstream', async () => {
  const r = route({ enabled: false });
  assert.equal((await r.get()).status, 403);
  assert.equal(r.calls.length, 0);
});
test('cover response uses source Referer and private image cache', async () => {
  const r = route();
  const response = await r.get();
  assert.equal(response.status, 200);
  assert.equal(r.calls[0].options.headers.Referer, 'https://huangguoai.com/');
  assert.equal(response.headers.get('Content-Type'), 'image/png');
  assert.equal(response.headers.get('Cache-Control'), 'private, max-age=3600');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
});
test('target validation errors and oversized bodies do not return successful images', async () => {
  assert.equal((await route({ invalid: true }).get()).status, 502);
  assert.equal((await route({ oversized: true }).get()).status, 502);
});
