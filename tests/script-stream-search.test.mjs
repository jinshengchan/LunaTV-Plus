import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function route({ sites = [], scripts = [], fail = false, auth = true, filtered = false } = {}) {
  const calls = [];
  const result = { title: 'Fixture', id: '1', type_name: filtered ? 'blocked' : '' };
  const modules = {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/auth': { getAuthInfoFromCookie: () => auth ? { username: 'admin' } : null },
    '@/lib/config': { getConfig: async () => ({ SiteConfig: { DisableYellowFilter: false } }), getAvailableApiSites: async () => sites },
    '@/lib/downstream': { searchFromApi: async site => [{ ...result, source: site.key }] },
    '@/lib/yellow': { yellowWords: ['blocked'] },
    '@/lib/source-script': {
      listEnabledSourceScripts: async () => scripts,
      executeSavedSourceScript: async input => {
        calls.push(input);
        if (fail) throw new Error('fixture request failed');
        return { result: input.hook === 'getSources' ? [{ id: 'default', name: '主站' }] : { list: [result] } };
      },
      normalizeScriptSources: result => result,
      normalizeScriptSearchResults: input => input.result.list.map(item => ({ ...item, source: `script:${input.scriptKey}:${input.sourceId}`, source_name: `${input.scriptName} / ${input.sourceName}` })),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/app/api/search/ws/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require: name => modules[name], Response, ReadableStream, TextEncoder, URL, setTimeout, clearTimeout, console: { warn() {}, log() {} } });
  return { calls, get: () => module.exports.GET({ url: 'https://local.test/api/search/ws?q=Fixture' }) };
}
async function events(instance) {
  const response = await instance.get();
  return (await response.text()).trim().split('\n\n').map(line => JSON.parse(line.slice(6)));
}
test('fluid search includes scripts alongside normal sources and counts completion once', async () => {
  const instance = route({ sites: [{ key: 'normal', name: 'Normal' }], scripts: [{ key: 'j18', name: '18J' }] });
  const data = await events(instance);
  assert.equal(data[0].totalSources, 2);
  const script = data.find(event => event.source === 'script:j18');
  assert.equal(script.results[0].source, 'script:j18:default');
  assert.equal(script.results[0].source_name, '18J / 主站');
  assert.equal(instance.calls[1].payload.keyword, 'Fixture');
  assert.equal(data.at(-1).type, 'complete');
  assert.equal(data.at(-1).completedSources, 2);
  assert.equal(data.at(-1).totalResults, 2);
  assert.equal(data.filter(event => event.type === 'complete').length, 1);
});
test('script errors do not prevent normal sources or stream completion', async () => {
  const data = await events(route({ sites: [{ key: 'normal', name: 'Normal' }], scripts: [{ key: 'script', name: 'Script' }], fail: true }));
  assert.equal(data.find(event => event.source === 'script:script').type, 'source_error');
  assert.equal(data.at(-1).completedSources, 2);
  assert.equal(data.at(-1).totalResults, 1);
});
test('empty source list still terminates the event stream', async () => {
  const data = await events(route());
  assert.deepEqual(data.map(event => event.type), ['start', 'complete']);
});
test('script-only search applies the existing category filter', async () => {
  const data = await events(route({ scripts: [{ key: 'fixture', name: 'Fixture' }], filtered: true }));
  assert.equal(data.find(event => event.type === 'source_result').results.length, 0);
  assert.equal(data.at(-1).totalResults, 0);
});
test('unauthenticated access does not invoke script hooks', async () => {
  const instance = route({ auth: false });
  assert.equal((await instance.get()).status, 401);
  assert.equal(instance.calls.length, 0);
});
