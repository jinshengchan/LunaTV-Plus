// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/app/api/acg/health/route.ts
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  getMagnetHealthConcurrency,
  MagnetHealthBusyError,
  probeMagnetHealth,
  resolveMagnetHealthProxy,
} from '@/lib/magnet-health';

export const runtime = 'nodejs';

/**
 * POST /api/acg/health
 * 单条磁力/种子 Tracker scrape 测活（动漫磁链搜索共用）
 * body: { url: string, skipCache?: boolean }
 * - 需要登录（LunaTV 统一的 cookie 鉴权）
 * - 全站同时测活上限：环境变量 MAGNET_HEALTH_MAX_CONCURRENT（默认 10）
 * - HTTP 代理：环境变量 MAGNET_HEALTH_PROXY（默认直连）
 */
export async function POST(req: NextRequest) {
  // 权限检查：需要登录
  const authInfo = getAuthInfoFromCookie(req);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    const skipCache = Boolean(body?.skipCache);

    if (!url) {
      return NextResponse.json({ error: '链接不能为空' }, { status: 400 });
    }

    // 粗限长度，避免乱丢超大 body
    if (url.length > 8192) {
      return NextResponse.json({ error: '链接过长' }, { status: 400 });
    }

    const result = await probeMagnetHealth({
      url,
      proxy: resolveMagnetHealthProxy(),
      skipCache,
    });

    return NextResponse.json({
      success: true,
      ...result,
      concurrency: getMagnetHealthConcurrency(),
    });
  } catch (error: any) {
    if (error instanceof MagnetHealthBusyError || error?.code === 'MAGNET_HEALTH_BUSY') {
      return NextResponse.json(
        {
          error: error.message || '测活繁忙，请稍后再试',
          code: 'MAGNET_HEALTH_BUSY',
          concurrency: getMagnetHealthConcurrency(),
        },
        { status: 429 }
      );
    }

    console.error('磁力测活失败:', error);
    return NextResponse.json(
      { error: error?.message || '测活失败' },
      { status: 500 }
    );
  }
}
