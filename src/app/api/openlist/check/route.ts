// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/app/api/openlist/check/route.ts
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.
/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { OpenListClient } from '@/lib/openlist.client';

export const runtime = 'nodejs';

/**
 * POST /api/openlist/check
 * 检查 OpenList 连通性
 * body: { url, username, password }
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

    // 获取请求参数
    const body = await request.json();
    const { url, username, password } = body;

    if (!url || !username || !password) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 创建客户端并检查连通性
    const client = new OpenListClient(url, username, password);
    const result = await client.checkConnectivity();

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: result.message,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: result.message,
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('检查 OpenList 连通性失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '检查失败',
      },
      { status: 500 }
    );
  }
}
