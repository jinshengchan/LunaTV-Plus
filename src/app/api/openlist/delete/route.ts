// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/app/api/openlist/delete/route.ts
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.
/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { clearConfigCache, getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  invalidateMetaInfoCache,
  MetaInfo,
  setCachedMetaInfo,
} from '@/lib/openlist-cache';
import { readOpenListConfig, writeOpenListConfig } from '@/lib/openlist-config';

export const runtime = 'nodejs';

// TODO(port): 源站使用 db.getGlobalValue('video.metainfo') 持久化元数据；
// LunaTV 暂无该接口，此处用 db 缓存代替（注意缓存可能过期，大数据量请接入持久化存储）。
const METAINFO_DB_KEY = 'openlist:video.metainfo';
const METAINFO_DB_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 年

/**
 * POST /api/openlist/delete
 * 删除私人影库中的视频记录（仅删除元数据记录，不删除 OpenList 上的实际文件）
 * body: { key }
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
    const { key } = body;

    if (!key) {
      return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
    }

    // 获取配置
    const config = await getConfig();
    const openListConfig = readOpenListConfig(config);

    if (
      !openListConfig ||
      !openListConfig.enabled ||
      !openListConfig.url
    ) {
      return NextResponse.json(
        { error: 'OpenList 未配置或未启用' },
        { status: 400 }
      );
    }

    // 从数据库读取 metainfo
    const cached = await db.getCache(METAINFO_DB_KEY);
    if (!cached) {
      return NextResponse.json(
        { error: '未找到视频元数据' },
        { status: 404 }
      );
    }
    const metaInfo: MetaInfo =
      typeof cached === 'string' ? JSON.parse(cached) : (cached as MetaInfo);

    // 检查 key 是否存在
    if (!metaInfo.folders[key]) {
      return NextResponse.json(
        { error: '未找到该视频记录' },
        { status: 404 }
      );
    }

    // 删除记录
    delete metaInfo.folders[key];

    // 保存到数据库
    await db.setCache(METAINFO_DB_KEY, JSON.stringify(metaInfo), METAINFO_DB_TTL_SECONDS);

    // 更新内存缓存
    invalidateMetaInfoCache();
    setCachedMetaInfo(metaInfo);

    // 更新配置中的资源数量
    const cfg = readOpenListConfig(config);
    if (cfg) {
      writeOpenListConfig(config, {
        ...cfg,
        resourceCount: Object.keys(metaInfo.folders).length,
      });
      await db.saveAdminConfig(config);
      clearConfigCache();
    }

    return NextResponse.json({
      success: true,
      message: '删除成功',
    });
  } catch (error) {
    console.error('删除视频记录失败:', error);
    return NextResponse.json(
      { error: '删除失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
