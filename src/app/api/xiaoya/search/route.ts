// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/app/api/xiaoya/search/route.ts
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.
/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { DEFAULT_USER_AGENT } from '@/lib/user-agent';
import { getXiaoyaConfig } from '@/lib/xiaoya.client';

export const runtime = 'nodejs';

/**
 * GET /api/xiaoya/search?keyword=<keyword>&type=<type>
 * 搜索小雅视频（使用小雅的网页搜索引擎，需要登录）
 *
 * 适配说明：MoonTVPlus 使用 `requireFeaturePermission(request, 'xiaoya', ...)` 做细粒度
 * 功能权限校验，LunaTV 暂无 `@/lib/permissions`，此处降级为普通登录校验
 *（与 src/app/api/acg/nyaa/route.ts 一致）。
 */
export async function GET(request: NextRequest) {
  try {
    // 权限检查：需要登录
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get('keyword');
    const type = searchParams.get('type') || 'video'; // video, music, ebook, all

    if (!keyword) {
      return NextResponse.json({ error: '缺少搜索关键词' }, { status: 400 });
    }

    const config = await getConfig();
    const xiaoyaConfig = getXiaoyaConfig(config);

    if (!xiaoyaConfig) {
      return NextResponse.json({ error: '小雅未配置或未启用' }, { status: 400 });
    }

    // 使用小雅的搜索引擎
    const searchUrl = `${xiaoyaConfig.ServerURL}/search?box=${encodeURIComponent(keyword)}&type=${type}&url=`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`搜索请求失败: ${response.status}`);
    }

    const html = await response.text();

    // 解析 HTML 中的链接
    // 格式: <a href=/path/to/file>path/to/file</a>
    const linkRegex = /<a href=([^>]+)>([^<]+)<\/a>/g;
    const results: Array<{ name: string; path: string }> = [];

    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      let path = match[1];
      const displayText = match[2];

      // 跳过返回首页和频道链接
      if (path === '/' || path.startsWith('http')) {
        continue;
      }

      // URL 解码路径
      try {
        path = decodeURIComponent(path);
      } catch (e) {
        console.error('URL 解码失败:', path, e);
      }

      // 提取文件名（路径的最后一部分）
      const pathParts = displayText.split('/');
      const fileName = pathParts[pathParts.length - 1];

      results.push({
        name: fileName,
        path: path,
      });
    }

    return NextResponse.json({
      videos: results,
      total: results.length,
    });
  } catch (error) {
    console.error('小雅搜索失败:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
