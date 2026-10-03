// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/app/api/xiaoya/browse/route.ts
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getXiaoyaConfig, XiaoyaClient } from '@/lib/xiaoya.client';

export const runtime = 'nodejs';

/**
 * GET /api/xiaoya/browse?path=<path>
 * 浏览小雅目录（需要登录）
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
    const path = searchParams.get('path') || '/';

    const config = await getConfig();
    // TODO(port): wire to AdminConfig.xiaoya — 需在 src/lib/admin.types.ts 的 AdminConfig 中补 XiaoyaConfig 字段
    const xiaoyaConfig = getXiaoyaConfig(config);

    if (!xiaoyaConfig) {
      return NextResponse.json({ error: '小雅未配置或未启用' }, { status: 400 });
    }

    const client = new XiaoyaClient(
      xiaoyaConfig.ServerURL,
      xiaoyaConfig.Username,
      xiaoyaConfig.Password,
      xiaoyaConfig.Token
    );

    // 循环翻页获取全部条目（alist 单页上限100，避免大目录被截断）
    const firstPage = await client.listDirectory(path);
    const allContent = [...firstPage.content];
    const total = firstPage.total || allContent.length;
    let page = 2;
    while (allContent.length < total && page <= 200) {
      const next = await client.listDirectory(path, page, 100, false);
      if (!next.content || next.content.length === 0) break;
      allContent.push(...next.content);
      page += 1;
    }
    const result = { content: allContent, total };

    // 过滤出文件夹和视频文件
    const videoExtensions = ['.mp4', '.mkv', '.avi', '.m3u8', '.flv', '.ts', '.mov', '.wmv', '.webm'];

    const folders = result.content
      .filter(item => item.is_dir)
      .map(item => ({
        name: item.name,
        path: `${path}${path.endsWith('/') ? '' : '/'}${item.name}`,
      }));

    const files = result.content
      .filter(item =>
        !item.is_dir &&
        videoExtensions.some(ext => item.name.toLowerCase().endsWith(ext))
      )
      .map(item => ({
        name: item.name,
        path: `${path}${path.endsWith('/') ? '' : '/'}${item.name}`,
      }));

    return NextResponse.json({
      folders,
      files,
      currentPath: path,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
