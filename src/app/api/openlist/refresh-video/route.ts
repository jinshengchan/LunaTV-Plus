// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/app/api/openlist/refresh-video/route.ts
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.
/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { invalidateVideoInfoCache } from '@/lib/openlist-cache';
import { readOpenListConfig } from '@/lib/openlist-config';

export const runtime = 'nodejs';

/**
 * POST /api/openlist/refresh-video
 * 刷新单个视频的 videoinfo.json（清除内存缓存，下次访问时重新解析）
 * body: { folder }
 */
export async function POST(request: NextRequest) {
  try {
    // 权限检查：需要登录（LunaTV nyaa 路由同款风格）
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    // TODO(port): 源站此处还有 requireFeaturePermission(request, 'private_library') 功能权限校验；
    // LunaTV 暂无该权限体系，如需限制请在此接入。

    const body = await request.json();
    const { folder } = body;

    if (!folder) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const config = await getConfig();
    const openListConfig = readOpenListConfig(config);

    if (
      !openListConfig ||
      !openListConfig.enabled ||
      !openListConfig.url ||
      !openListConfig.username ||
      !openListConfig.password
    ) {
      return NextResponse.json({ error: 'OpenList 未配置或未启用' }, { status: 400 });
    }

    // folder 已经是完整路径，直接使用
    const folderPath = folder;

    // 清除缓存
    invalidateVideoInfoCache(folderPath);

    return NextResponse.json({
      success: true,
      message: '刷新成功',
    });
  } catch (error) {
    console.error('刷新视频失败:', error);
    return NextResponse.json(
      { error: '刷新失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
