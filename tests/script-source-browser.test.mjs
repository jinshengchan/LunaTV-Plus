import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as cheerio from 'cheerio/slim';

const code = fs.readFileSync(new URL('../scripts/sources/18j-v2.js', import.meta.url), 'utf8');
const script = new Function(code)();
const calls = [];
const fixtures = new Map();
const ctx = {
  utils: { randomUA: () => 'test', joinUrl: (base, path) => new URL(path, base).href,
    buildUrl: (base, params) => base + '?' + new URLSearchParams(params) },
  html: { load: cheerio.load },
  request: { getJson: async () => ({ list: [{ id: '1', name: 'Fixture', pic: '/poster.jpg' }] }) },
  fetch: async ({ url }) => { calls.push(url); return { ok: true, text: async () => fixtures.get(url) || '' }; },
};
const sourceScript = {
  listEnabledSourceScripts: async () => [{ key: 'j18', name: '18J' }],
  normalizeScriptSources: value => value,
  executeSavedSourceScript: async ({ hook, payload }) => ({ result: await script[hook](ctx, payload) }),
};
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/script-source-browser.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module, exports: module.exports, require: () => sourceScript });
const browser = module.exports;
const first = 'https://18j.tv/label/hot/by/time/';
fixtures.set(first, '<a href="/v/1-1-1/"><img data-original="/cover.jpg"></a><a href="/v/1-1-1/"><h3 class="title">Fixture</h3></a><a href="/label/hot/by/time/page/8/">Last</a><a href="/t/1/page/100/">Other category</a>');
fixtures.set('https://18j.tv/t/2/page/3/', '<a href="/v/2-1-1/" title="Second"><img src="/second.jpg"></a><a href="/t/2/page/4/">Next</a>');

test('only enabled script keys can be used in the browser', async () => {
  assert.equal((await browser.getScriptBrowserSource('script:j18')).name, '18J');
  assert.equal(await browser.getScriptBrowserSource('script:disabled'), null);
  assert.equal(await browser.getScriptBrowserSource('normal'), null);
});
test('script sub-sources become browser categories', async () => {
  const categories = await browser.getScriptBrowserCategories('j18');
  assert.equal(categories.length, 7);
  assert.equal(categories[0].type_id, 'latest');
});
test('merges poster and title links and ignores pagination of other categories', async () => {
  const result = await browser.getScriptBrowserList('j18', 'latest', 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, 'Fixture');
  assert.equal(result.items[0].poster, 'https://18j.tv/cover.jpg');
  assert.equal(result.items[0].source, 'script:j18:latest');
  assert.equal(result.meta.pagecount, 8);
});
test('requests the selected category page and retains it in playback source', async () => {
  const result = await browser.getScriptBrowserList('j18', 'cat_2', 3);
  assert.equal(calls.at(-1), 'https://18j.tv/t/2/page/3/');
  assert.equal(result.meta.page, 3);
  assert.equal(result.meta.pagecount, 4);
  assert.equal(result.items[0].source, 'script:j18:cat_2');
});
test('source-specific keyword search defaults to latest and stops after one page', async () => {
  assert.equal((await browser.getScriptBrowserList('j18', null, 1, 'Fixture')).items.length, 1);
  assert.equal((await browser.getScriptBrowserList('j18', null, 2, 'Fixture')).items.length, 0);
});
test('invalid categories cannot cause arbitrary URL requests', async () => {
  const before = calls.length;
  await assert.rejects(browser.getScriptBrowserList('j18', '../bad', 1), /分类不存在/);
  assert.equal(calls.length, before);
});
test('saved v2 import embeds the same script and updates the existing key', () => {
  const payload = JSON.parse(fs.readFileSync(new URL('../scripts/sources/18j-v2.import.json', import.meta.url)));
  assert.equal(payload.items[0].code, code);
  assert.equal(payload.items[0].key, 'j18');
});
