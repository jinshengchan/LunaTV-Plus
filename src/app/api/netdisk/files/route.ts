import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  createNetDiskSession,
  listNetDiskFiles,
  netDiskCapabilities,
} from '@/lib/netdisk-playback';
import { parseNetDiskShare } from '@/lib/netdisk-share';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (!getAuthInfoFromCookie(request)?.username)
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json(await netDiskCapabilities(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: NextRequest) {
  const username = getAuthInfoFromCookie(request)?.username;
  if (!username) return NextResponse.json({ error: '未登录' }, { status: 401 });
  try {
    const body = await request.json();
    let id = body.sessionId;
    if (!id) {
      if (
        typeof body.url !== 'string' ||
        body.url.length > 2000 ||
        typeof (body.password || '') !== 'string'
      )
        throw new Error('分享链接参数不正确');
      const share = parseNetDiskShare(body.url, body.password || '');
      id = (
        await createNetDiskSession(
          username,
          share.provider,
          share.shareId,
          share.password,
          typeof body.title === 'string' ? body.title : '',
        )
      ).id;
    }
    const folderId = body.folderId || '0';
    const page = body.page ?? 1;
    if (
      typeof id !== 'string' ||
      typeof folderId !== 'string' ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 100
    )
      throw new Error('目录参数不正确');
    return NextResponse.json(
      await listNetDiskFiles(id, username, folderId, page),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '读取网盘文件失败' },
      { status: 400 },
    );
  }
}
