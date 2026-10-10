import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { decodeHuangguoCover } from '@/lib/huangguo-cover';
import {
  fetchWithValidatedRedirects,
  readArrayBufferLimited,
} from '@/lib/proxy-security';
import { listEnabledSourceScripts } from '@/lib/source-script';
import { DEFAULT_USER_AGENT } from '@/lib/user-agent';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = getAuthInfoFromCookie(request);
  if (!auth?.username)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(request.url).searchParams.get('url');
  if (!url)
    return NextResponse.json({ error: '缺少封面地址' }, { status: 400 });
  try {
    if (
      !(await listEnabledSourceScripts()).some(
        (item) => item.key === 'huangguo_fongmi',
      )
    ) {
      return NextResponse.json({ error: '源未启用' }, { status: 403 });
    }
    const response = await fetchWithValidatedRedirects(
      url,
      {
        headers: {
          Referer: 'https://huangguoai.com/',
          'User-Agent': DEFAULT_USER_AGENT,
        },
        signal: AbortSignal.timeout(15000),
      },
      { timeoutMs: 15000 },
    );
    if (!response.ok) throw new Error('封面请求失败');
    const input = await readArrayBufferLimited(response, 4 * 1024 * 1024);
    const image = decodeHuangguoCover(new Uint8Array(input));
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        'Content-Type': image.type,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        Vary: 'Cookie',
      },
    });
  } catch {
    return NextResponse.json({ error: '封面获取或解密失败' }, { status: 502 });
  }
}
