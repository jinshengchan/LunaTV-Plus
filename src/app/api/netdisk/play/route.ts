import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { prepareNetDiskVideo } from '@/lib/netdisk-playback';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const username = getAuthInfoFromCookie(request)?.username;
  if (!username) return NextResponse.json({ error: '未登录' }, { status: 401 });
  try {
    const { sessionId, fileId } = await request.json();
    if (typeof sessionId !== 'string' || typeof fileId !== 'string')
      throw new Error('视频参数不正确');
    return NextResponse.json(
      await prepareNetDiskVideo(sessionId, username, fileId),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '准备播放失败' },
      { status: 400 },
    );
  }
}
