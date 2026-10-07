import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canSendNetDiskCookie,
  NetDiskShareClient,
  parseNetDiskShare,
} from '../src/lib/netdisk-share.ts';

const ok = (data) =>
  new Response(JSON.stringify({ code: 0, status: 200, data }), {
    headers: { 'Content-Type': 'application/json' },
  });
const video = {
  id: 'file-1',
  name: '第01集.mp4',
  parentId: '0',
  size: 100,
  video: true,
  directory: false,
  shareFileToken: 'share-file-test',
};

test('recognizes supported share hosts and extraction codes', () => {
  assert.deepEqual(
    parseNetDiskShare('https://pan.quark.cn/s/abc123?pwd=1234'),
    { provider: 'quark', shareId: 'abc123', password: '1234' },
  );
  assert.equal(
    parseNetDiskShare('https://drive.uc.cn/s/abc123', '5678').password,
    '5678',
  );
});

test('rejects fake hosts, credentials in URLs, arbitrary ports and unsupported schemes', () => {
  for (const url of [
    'https://pan.quark.cn.evil.test/s/abc',
    'https://evil.test/s/abc',
    'http://pan.quark.cn/s/abc',
    'https://user:secret@pan.quark.cn/s/abc',
    'https://pan.quark.cn:8443/s/abc',
    'https://pan.quark.cn/not-a-share',
  ]) {
    assert.throws(() => parseNetDiskShare(url));
  }
});

test('account cookies are sent only to HTTPS hosts of the selected provider', () => {
  assert.equal(
    canSendNetDiskCookie('quark', 'https://pds.quark.cn/video'),
    true,
  );
  assert.equal(canSendNetDiskCookie('uc', 'https://cdn.uc.cn/video'), true);
  for (const url of [
    'https://quark.cn.evil.test/v',
    'https://evilquark.cn/v',
    'http://pds.quark.cn/v',
    'https://cdn.uc.cn/v',
    'https://user@pds.quark.cn/v',
  ]) {
    assert.equal(canSendNetDiskCookie('quark', url), false);
  }
});

test('Quark and UC use their own API, authorization headers and share-token payload', async () => {
  for (const provider of ['quark', 'uc']) {
    const client = new NetDiskShareClient(
      provider,
      { cookie: 'session=test' },
      async (url, options) => {
        assert.equal(
          new URL(url).hostname,
          provider === 'quark' ? 'drive-pc.quark.cn' : 'pc-api.uc.cn',
        );
        assert.equal(
          new URL(url).searchParams.get('pr'),
          provider === 'quark' ? 'ucpro' : 'UCBrowser',
        );
        assert.equal(options.headers.Cookie, 'session=test');
        assert.equal(options.redirect, 'error');
        assert.deepEqual(JSON.parse(options.body), {
          pwd_id: 'abc',
          passcode: '1234',
        });
        return ok({ stoken: 'share-token-test' });
      },
    );
    assert.equal(await client.shareToken('abc', '1234'), 'share-token-test');
  }
});

test('lists nested folders, recognizes video files and preserves page boundaries', async () => {
  const client = new NetDiskShareClient(
    'quark',
    { cookie: 'session=test' },
    async (url) => {
      assert.equal(new URL(url).searchParams.get('pdir_fid'), 'folder');
      assert.equal(new URL(url).searchParams.get('_page'), '2');
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            list: [
              { fid: 'dir', file_name: '电视剧', dir: true },
              {
                fid: 'video',
                file_name: '第02集.MP4',
                dir: false,
                size: 100,
                share_fid_token: 'test',
              },
              { fid: 'text', file_name: '说明.txt', dir: false },
            ],
          },
          metadata: { _total: 101 },
        }),
      );
    },
  );
  const result = await client.list('abc', 'token', 'folder', 2);
  assert.equal(result.hasMore, true);
  assert.equal(result.files[0].directory, true);
  assert.equal(result.files[1].video, true);
  assert.equal(result.files[1].parentId, 'folder');
  assert.equal(result.files[2].video, false);
});

test('prepares a dedicated directory, transfers the selected video and polls its saved ID', async () => {
  const paths = [];
  const client = new NetDiskShareClient(
    'quark',
    { cookie: 'session=test' },
    async (raw, options) => {
      const url = new URL(raw);
      paths.push(url.pathname);
      if (url.pathname.endsWith('/path_list')) return ok([]);
      if (url.pathname.endsWith('/file')) {
        assert.equal(
          JSON.parse(options.body).dir_path,
          '/MoonTV在线播放/abc123/0',
        );
        return ok({ fid: 'folder-saved' });
      }
      if (url.pathname.endsWith('/sort')) return ok({ list: [] });
      if (url.pathname.endsWith('/save')) {
        const body = JSON.parse(options.body);
        assert.deepEqual(body.fid_list, ['file-1']);
        assert.deepEqual(body.fid_token_list, ['share-file-test']);
        assert.equal(body.to_pdir_fid, 'folder-saved');
        return ok({ task_id: 'task-test' });
      }
      assert.ok(url.pathname.endsWith('/task'));
      return ok({ status: 2, save_as: { save_as_top_fids: ['saved-video'] } });
    },
    async () => {},
  );
  assert.equal(await client.save('abc123', 'token', video), 'saved-video');
  assert.equal(paths.length, 5);
  assert.equal(
    paths.some((path) => path.includes('delete')),
    false,
  );
});

test('reuses a previously transferred file rather than copying it again', async () => {
  const client = new NetDiskShareClient(
    'quark',
    { cookie: 'session=test' },
    async (url) => {
      if (new URL(url).pathname.endsWith('/path_list'))
        return ok([{ fid: 'existing-folder' }]);
      assert.ok(new URL(url).pathname.endsWith('/sort'));
      return ok({
        list: [
          { fid: 'existing-video', file_name: video.name, size: video.size },
        ],
      });
    },
  );
  assert.equal(await client.save('abc123', 'token', video), 'existing-video');
});

test('bounds asynchronous transfer polling instead of waiting forever', async () => {
  let polls = 0;
  const client = new NetDiskShareClient(
    'quark',
    { cookie: 'session=test' },
    async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/path_list')) return ok([{ fid: 'folder' }]);
      if (path.endsWith('/sort')) return ok({ list: [] });
      if (path.endsWith('/save')) return ok({ task_id: 'task' });
      polls++;
      return ok({ status: 1 });
    },
    async () => {},
  );
  await assert.rejects(client.save('abc123', 'token', video), /处理中/);
  assert.equal(polls, 20);
});

test('never echoes upstream messages containing credentials or signed URLs', async () => {
  const client = new NetDiskShareClient(
    'quark',
    { cookie: 'session=test' },
    async () =>
      new Response(
        JSON.stringify({
          code: 123,
          message: 'secret-account-cookie-and-signed-download-url',
        }),
      ),
  );
  await assert.rejects(
    client.shareToken('abc', ''),
    (error) =>
      !error.message.includes('secret-account') &&
      error.message.includes('请求被拒绝'),
  );
});

test('preserves rotated account cookies for later requests', async () => {
  let count = 0;
  const client = new NetDiskShareClient(
    'quark',
    { cookie: '__puus=old; session=test' },
    async (_url, options) => {
      if (count++ === 0) {
        const response = ok({ stoken: 'token' });
        response.headers.append('Set-Cookie', '__puus=new; Secure; Path=/');
        return response;
      }
      assert.equal(options.headers.Cookie.includes('__puus=new'), true);
      assert.equal(options.headers.Cookie.includes('__puus=old'), false);
      return ok([{ download_url: 'https://pds.quark.cn/test.mp4' }]);
    },
  );
  await client.shareToken('abc', '');
  assert.equal(await client.download('file'), 'https://pds.quark.cn/test.mp4');
});
