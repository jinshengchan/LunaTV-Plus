/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites } from '@/lib/config';
import { listEnabledSourceScripts } from '@/lib/source-script';

export const runtime = 'nodejs';

// OrionTV 兼容接口
export async function GET(request: NextRequest) {
  console.log('request', request.url);

  // 添加用户认证检查
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const apiSites = await getAvailableApiSites(authInfo.username);

    // 实验性：视频源脚本（移植自 MoonTVPlus），以 script: 前缀标识
    const scriptSites = (await listEnabledSourceScripts()).map((item) => ({
      key: `script:${item.key}`,
      name: item.name,
      script: true,
    }));

    return NextResponse.json([...apiSites, ...scriptSites]);
  } catch (error) {
    return NextResponse.json({ error: '获取资源失败' }, { status: 500 });
  }
}
