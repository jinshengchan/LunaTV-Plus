import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import * as cheerio from 'cheerio/slim';
import { decodeHuangguoCover } from '../src/lib/huangguo-cover.ts';

const code = fs.readFileSync(new URL('../scripts/sources/huangguo.js', import.meta.url), 'utf8');
const script = new Function('require', code)();
const fixtures = new Map();
const calls = [];
const ctx = {
  html: { load: cheerio.load },
  fetch: async ({ url, headers }) => { calls.push({ url, headers }); const html = fixtures.get(url); return { ok: html !== undefined, status: html === undefined ? 404 : 200, text: async () => html }; },
};
const card = '<div class="hg-card-grid"><div class="hg-drama-card"><a href="/video/123/"><img data-src="/cover.bin?token=keep"></a><a href="/video/123/" class="hg-drama-card__title">Fixture</a><span class="hg-drama-card__episode">2 episodes</span></div></div>';
fixtures.set('https://huangguoai.com/', card);
fixtures.set('https://huangguoai.com/ai-duanju/2/', card + '<a href="/ai-duanju/3/">Next</a>');
fixtures.set('https://huangguoai.com/search/video/Fixture/', card + '<a href="/search/video/Fixture/2/">Next</a>');
fixtures.set('https://huangguoai.com/video/123/', '<h1>Fixture detail</h1><div class="hg-web-detail__ep-grid"><a href="/video/123/ep-2/" data-ep-id="2">2</a><a href="/video/123/" data-ep-id="1">1</a></div><script id="videoInitialData">{"coverSrc":"/cover.bin","videoSrc":"https://cdn.test/first.m3u8"}</script>');
fixtures.set('https://huangguoai.com/video/123/ep-2/', '<script id="videoInitialData">{"epPlaySrcs":{"2":"https://cdn.test/second.m3u8"},"videoSrc":"https://cdn.test/first.m3u8"}</script>');

test('native sub-sources are exposed as LunaTV categories', async () => {
  const sources = await script.getSources(ctx);
  assert.equal(sources[0].id, 'home');
  assert(sources.some(source => source.id === 'ai-duanju'));
});
test('category pagination preserves exact page URL and encrypted cover query', async () => {
  const result = await script.search(ctx, { keyword: '', sourceId: 'ai-duanju', page: 2 });
  assert.equal(calls.at(-1).url, 'https://huangguoai.com/ai-duanju/2/');
  assert.equal(result.pageCount, 3);
  assert.equal(result.list[0].title, 'Fixture');
  const cover = new URL(result.list[0].poster, 'https://local.test');
  assert.equal(cover.pathname, '/api/source-script/huangguo-cover');
  assert.equal(cover.searchParams.get('url'), 'https://huangguoai.com/cover.bin?token=keep');
});
test('keyword search executes only for the primary sub-source', async () => {
  const result = await script.search(ctx, { keyword: 'Fixture', sourceId: 'home', page: 1 });
  assert.equal(result.list.length, 1);
  assert.equal(result.pageCount, 2);
  const count = calls.length;
  assert.equal((await script.search(ctx, { keyword: 'Fixture', sourceId: 'ai-duanju', page: 1 })).list.length, 0);
  assert.equal(calls.length, count);
});
test('recommend hook works even when called without this binding', async () => {
  const recommend = script.recommend;
  assert.equal((await recommend(ctx, { page: 1 })).list.length, 1);
});
test('detail retains episode ordering and selected sub-source', async () => {
  const result = await script.detail(ctx, { id: '123', sourceId: 'ai-duanju' });
  assert.equal(result.title, 'Fixture detail');
  assert.deepEqual(result.playbacks[0].episodes_titles, ['第1集', '第2集']);
  assert.equal(result.playbacks[0].sourceId, 'ai-duanju');
  assert(result.playbacks[0].episodes[1].endsWith('/ep-2/|||2'));
});
test('play resolution selects the requested episode rather than the first one', async () => {
  const result = await script.resolvePlayUrl(ctx, { playUrl: 'https://huangguoai.com/video/123/ep-2/|||2' });
  assert.equal(result.url, 'https://cdn.test/second.m3u8');
  assert.equal(result.headers.Referer, 'https://huangguoai.com/');
});
test('invalid IDs, categories and playback origins are rejected before fetching', async () => {
  await assert.rejects(script.detail(ctx, { id: '../bad' }), /ID/);
  await assert.rejects(script.search(ctx, { sourceId: '../bad' }), /分类/);
  await assert.rejects(script.resolvePlayUrl(ctx, { playUrl: 'http://127.0.0.1/video/123/' }), /分集/);
});
test('upstream failures stay visible instead of becoming a successful empty result', async () => {
  await assert.rejects(script.detail(ctx, { id: '999' }), /404/);
});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');
test('decrypts AES cover bytes and also accepts ordinary images', () => {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from('f5d965df75336270'), Buffer.from('97b60394abc2fbe1'));
  const encrypted = Buffer.concat([cipher.update(png), cipher.final()]);
  assert.deepEqual(decodeHuangguoCover(encrypted).bytes, png);
  assert.equal(decodeHuangguoCover(encrypted).type, 'image/png');
  assert.deepEqual(decodeHuangguoCover(png).bytes, png);
});
test('rejects corrupt encrypted images', () => {
  assert.throws(() => decodeHuangguoCover(Buffer.alloc(17)), /无效/);
  assert.throws(() => decodeHuangguoCover(Buffer.alloc(32)), /解密失败/);
});
test('import configuration embeds the exact adapter under the existing TVBox key', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../scripts/sources/huangguo.import.json', import.meta.url)));
  assert.equal(config.items[0].key, 'huangguo_fongmi');
  assert.equal(config.items[0].code, code);
});
