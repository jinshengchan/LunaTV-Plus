// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/app/api/acg/download/route.ts
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.
/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { ensureAdmin } from '@/lib/admin-auth';
import { getConfig } from '@/lib/config';
import { readOpenListConfig } from '@/lib/openlist-config';
import {
  addOpenListOfflineDownload,
  getOfflineDownloadBasePath,
  joinOpenListPath,
} from '@/lib/openlist-offline-download';

export const runtime = 'nodejs';

const downloadTools = ['aria2', 'Transmission', 'qBittorrent'] as const;
type DownloadTool = typeof downloadTools[number];

function isDownloadTool(tool: unknown): tool is DownloadTool {
  return typeof tool === 'string' && downloadTools.includes(tool as DownloadTool);
}

/**
 * POST /api/acg/download
 * 添加 ACG 资源（磁力链/种子直链）到 OpenList 离线下载（仅管理员可用）
 * body: { url, name, tool = 'aria2' }
 *
 * NOTE(port): 源站使用 hasFeaturePermission(username, 'magnet_save_private_library')
 * 做权限校验（管理员/站长）；LunaTV 暂无该功能权限体系，此处改用 ensureAdmin
 *（owner/admin），语义与源站"仅管理员和站长可用"一致。
 */
export async function POST(req: NextRequest) {
  // 权限检查：仅管理员可用（LunaTV admin-auth 同款风格）
  try {
    await ensureAdmin(req);
  } catch {
    return NextResponse.json(
      { error: '无权限访问' },
      { status: 403 }
    );
  }

  try {
    const { url, name, tool = 'aria2' } = await req.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: '下载链接不能为空' },
        { status: 400 }
      );
    }

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: '资源名称不能为空' },
        { status: 400 }
      );
    }

    if (!isDownloadTool(tool)) {
      return NextResponse.json(
        { error: '下载方式不支持' },
        { status: 400 }
      );
    }

    // 获取 OpenList 配置
    const config = await getConfig();
    const openListConfig = readOpenListConfig(config);
    if (!openListConfig) {
      return NextResponse.json(
        { error: 'OpenList 未配置或未启用' },
        { status: 400 }
      );
    }

    // 构建下载路径（使用离线下载目录）
    const downloadPath = joinOpenListPath(
      getOfflineDownloadBasePath(openListConfig),
      name
    );
    await addOpenListOfflineDownload(openListConfig, downloadPath, url, tool);

    return NextResponse.json({
      success: true,
      message: '已添加到离线下载队列',
      path: downloadPath,
    });

  } catch (error: any) {
    console.error('添加离线下载任务失败:', error);
    return NextResponse.json(
      { error: error.message || '添加离线下载任务失败' },
      { status: 500 }
    );
  }
}
