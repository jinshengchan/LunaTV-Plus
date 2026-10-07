import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Exercise the real loader callback without requesting media over the network.
class BaseLoader {
  constructor() {
    this.load = (context, config, callbacks) =>
      callbacks.onSuccess({ data: config.fixture }, {}, context);
  }
}
const module = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      new URL('../src/lib/hls-loader.ts', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  {
    module,
    exports: module.exports,
    require: () => ({ default: { DefaultConfig: { loader: BaseLoader } } }),
    console: { log() {}, error() {} },
    URL,
    setTimeout,
    clearTimeout,
  },
);
const Loader = module.exports.default;
const playlist = (...lines) =>
  ['#EXTM3U', ...lines, '#EXT-X-ENDLIST'].join('\n');
function filter(fixture, config = {}) {
  let output;
  new Loader({ filterAds: true, ...config }).load(
    { type: 'manifest', url: 'https://cdn.test/master.m3u8' },
    { fixture },
    {
      onSuccess: (response) => {
        output = response.data;
      },
    },
  );
  return output;
}
for (const keyword of [
  'sponsor',
  '/ad/',
  '/ads/',
  'advert',
  'advertisement',
  '/adjump',
  'redtraffic',
]) {
  test(`removes URL keyword ${keyword} and preserves normal segments`, () => {
    const input = playlist(
      '#EXTINF:6,',
      'normal.ts',
      '#EXTINF:9,',
      `https://cdn.test/${keyword.toUpperCase()}/clip.ts`,
    );
    assert.equal(filter(input), playlist('#EXTINF:6,', 'normal.ts'));
  });
}
test('preserves #AD filtering with no URL keyword and adjacent keyword ads', () => {
  const input = playlist(
    '#AD',
    '#EXTINF:6,',
    'commercial.ts',
    '#EXTINF:9,',
    '/ads/clip.ts',
    '#EXTINF:5,',
    'normal.ts',
  );
  assert.equal(filter(input), playlist('#EXTINF:5,', 'normal.ts'));
});
test('custom TypeScript filter receives current source and takes priority', () => {
  const customAdFilterCode =
    'function filterAdsFromM3U8(type: string, content: string): string { return type + ":" + content; }';
  const input = playlist('#EXTINF:6,', '/ads/clip.ts');
  assert.equal(
    filter(input, { customAdFilterCode, currentSource: 'source001' }),
    `source001:${input}`,
  );
});
for (const code of [
  'throw new Error("bad");',
  'function filterAdsFromM3U8() { return null; }',
]) {
  test(`invalid custom filter falls back: ${code}`, () => {
    assert.equal(
      filter(
        playlist(
          '#AD',
          '#EXTINF:6,',
          'commercial.ts',
          '#EXTINF:9,',
          '/ads/clip.ts',
        ),
        { customAdFilterCode: code },
      ),
      playlist(),
    );
  });
}
test('disabled filtering leaves playlist intact and does not execute custom code', () => {
  const input = playlist('#AD', '#EXTINF:6,', '/ads/clip.ts');
  assert.equal(
    filter(input, {
      filterAds: false,
      customAdFilterCode: 'throw new Error("bad");',
    }),
    input,
  );
});

test('preserves discontinuity and encryption metadata around normal segments', () => {
  const input = playlist('#EXT-X-KEY:METHOD=AES-128,URI="key.bin"', '#EXT-X-DISCONTINUITY', '#EXTINF:6,', 'normal.ts');
  assert.equal(filter(input), input);
});
