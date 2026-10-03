// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/app/api/openlist/play/[token]/route.ts
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.
/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { OpenListClient } from '@/lib/openlist.client';
import {
  getPrimaryRootPath,
  readOpenListConfig,
} from '@/lib/openlist-config';
import { resolvePathMeta } from '@/lib/openlist-path-meta';
import {
  buildOpenListProxyUrl,
  resolveOpenListDirectPlayUrl,
} from '@/lib/openlist-play-url';

export const runtime = 'nodejs';

/**
 * GET /api/openlist/play/{token}?folder=xxx&fileName=xxx
 * 获取单个视频文件的播放链接（懒加载）
 * 返回重定向到真实播放 URL
 *
 * 权限验证：TVBox 全局订阅 Token（环境变量 TVBOX_SUBSCRIBE_TOKEN）或用户登录（满足其一即可）
 * NOTE(port): 源站还支持按用户分配的 tvbox token（db.getUsernameByTvboxToken），
 * LunaTV 暂无该机制，此处仅校验全局订阅 token；如需按用户 token 请另行接入。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token: requestToken } = await params;
    const { searchParams } = new URL(request.url);

    // 双重验证：TVBox 全局订阅 Token 或用户登录
    const globalToken = process.env.TVBOX_SUBSCRIBE_TOKEN;
    const authInfo = getAuthInfoFromCookie(request);

    const hasValidToken = !!(globalToken && requestToken === globalToken);
    // TODO(port): 源站对登录用户还校验 hasFeaturePermission(username, 'private_library')；
    // LunaTV 暂无该权限体系，此处仅要求已登录。
    const hasValidAuth = !!authInfo?.username;

    // 两者至少满足其一
    if (!hasValidToken && !hasValidAuth) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const folderName = searchParams.get('folder');
    const fileName = searchParams.get('fileName');

    if (!folderName || !fileName) {
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

    // metainfo 中的 folderName 已是完整路径；兼容旧式相对路径时拼接首选根目录
    const rootPath = getPrimaryRootPath(openListConfig);
    const folderPath = folderName.startsWith('/')
      ? folderName
      : `${rootPath}${rootPath.endsWith('/') ? '' : '/'}${folderName}`;
    const filePath = `${folderPath}/${fileName}`;

    // 解析路径元信息：路径开启代理播放时重定向到服务器代理地址
    const pathMetaResolved = resolvePathMeta(
      folderPath,
      openListConfig.pathMeta
    );

    if (pathMetaResolved.proxyPlay) {
      const host =
        request.headers.get('host') || request.headers.get('x-forwarded-host');
      const proto =
        request.headers.get('x-forwarded-proto') ||
        (host?.includes('localhost') || host?.includes('127.0.0.1')
          ? 'http'
          : 'https');
      const baseUrl = process.env.SITE_BASE || `${proto}://${host}`;
      const proxyUrl = buildOpenListProxyUrl({
        token: requestToken,
        folder: folderPath,
        fileName,
        baseUrl,
      });
      return NextResponse.redirect(proxyUrl);
    }

    const client = new OpenListClient(
      openListConfig.url,
      openListConfig.username,
      openListConfig.password
    );

    // 获取文件的播放链接
    const fileResponse = await client.getFile(filePath);

    if (fileResponse.code !== 200 || !fileResponse.data.raw_url) {
      console.error('[OpenList Play] 获取播放URL失败:', {
        fileName,
        code: fileResponse.code,
        message: fileResponse.message,
      });
      return NextResponse.json(
        { error: '获取播放链接失败' },
        { status: 500 }
      );
    }

    const playUrl = resolveOpenListDirectPlayUrl({
      openListBaseUrl: openListConfig.url,
      filePath,
      rawUrl: fileResponse.data.raw_url,
      sign: fileResponse.data.sign,
      provider: fileResponse.data.provider,
    });
    if (!playUrl) {
      throw new Error('获取到的播放链接为空');
    }

    return NextResponse.redirect(playUrl);
  } catch (error) {
    console.error('获取播放链接失败:', error);
    return NextResponse.json(
      { error: '获取失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
