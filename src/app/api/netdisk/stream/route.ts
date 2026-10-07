import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getNetDiskSession } from '@/lib/netdisk-playback';
import { canSendNetDiskCookie, NETDISK_USER_AGENT } from '@/lib/netdisk-share';
import { validateProxyTargetUrl } from '@/lib/proxy-security';

export const runtime = 'nodejs';

async function stream(request: NextRequest) {
  const owner = getAuthInfoFromCookie(request)?.username;
  if (!owner) return NextResponse.json({ error: '未登录' }, { status: 401 });
  try {
    const id = request.nextUrl.searchParams.get('session') || '';
    const fileId = request.nextUrl.searchParams.get('file') || '';
    const { session, client } = await getNetDiskSession(id, owner);
    const savedId = Object.hasOwn(session.saved, fileId)
      ? session.saved[fileId]
      : undefined;
    if (
      !savedId ||
      !Object.hasOwn(session.files, fileId) ||
      !session.files[fileId].video
    )
      throw new Error('请先选择并准备视频');
    let url = await client.download(savedId);
    for (let hop = 0; hop < 6; hop++) {
      url = await validateProxyTargetUrl(url);
      const headers = new Headers({
        'User-Agent': NETDISK_USER_AGENT,
        Referer: client.referer,
        'Accept-Encoding': 'identity',
      });
      if (canSendNetDiskCookie(session.provider, url))
        headers.set('Cookie', client.cookie);
      const range = request.headers.get('range');
      if (range) headers.set('Range', range);
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), 20000);
      let upstream: Response;
      try {
        upstream = await fetch(url, {
          method: request.method,
          headers,
          redirect: 'manual',
          signal: AbortSignal.any([request.signal, timeout.signal]),
        });
      } finally {
        clearTimeout(timer);
      }
      if ([301, 302, 303, 307, 308].includes(upstream.status)) {
        await upstream.body?.cancel();
        const location = upstream.headers.get('location');
        if (!location) throw new Error('网盘播放地址跳转失败');
        url = new URL(location, url).toString();
        continue;
      }
      if (!upstream.ok && upstream.status !== 416) {
        await upstream.body?.cancel();
        return NextResponse.json(
          { error: '网盘视频请求失败，请重新选择视频或更新账号授权' },
          { status: 502 },
        );
      }
      const output = new Headers({
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      for (const key of [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'last-modified',
        'etag',
      ]) {
        if (
          key === 'content-length' &&
          upstream.headers.get('content-encoding') &&
          upstream.headers.get('content-encoding') !== 'identity'
        )
          continue;
        const value = upstream.headers.get(key);
        if (value) output.set(key, value);
      }
      const contentType = output.get('content-type');
      if (!contentType || contentType.includes('application/octet-stream')) {
        const extension = session.files[fileId].name
          ?.split('.')
          .pop()
          ?.toLowerCase();
        const mediaTypes: Record<string, string> = {
          mp4: 'video/mp4',
          m4v: 'video/mp4',
          webm: 'video/webm',
          mov: 'video/quicktime',
          mkv: 'video/x-matroska',
        };
        if (extension && mediaTypes[extension])
          output.set('content-type', mediaTypes[extension]);
      }
      return new Response(request.method === 'HEAD' ? null : upstream.body, {
        status: upstream.status,
        headers: output,
      });
    }
    throw new Error('网盘播放地址跳转次数过多');
  } catch {
    // A proxy failure must never expose signed upstream URLs or account headers.
    return NextResponse.json(
      { error: '视频代理失败，请重新打开资源并检查网盘账号或服务器网络' },
      { status: 502 },
    );
  }
}

export const GET = stream;
export const HEAD = stream;
