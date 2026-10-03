// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/app/api/openlist/correct/route.ts
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.
/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { OpenListClient } from '@/lib/openlist.client';
import {
  getCachedMetaInfo,
  invalidateMetaInfoCache,
  MetaInfo,
  setCachedMetaInfo,
} from '@/lib/openlist-cache';
import { readOpenListConfig } from '@/lib/openlist-config';

export const runtime = 'nodejs';

// TODO(port): 源站使用 db.getGlobalValue('video.metainfo') 持久化元数据；
// LunaTV 暂无该接口，此处用 db 缓存代替（注意缓存可能过期，大数据量请接入持久化存储）。
const METAINFO_DB_KEY = 'openlist:video.metainfo';
const METAINFO_DB_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 年

/**
 * POST /api/openlist/correct
 * 纠正视频的TMDB映射
 * body: { key, tmdbId, doubanId, title, posterPath, releaseDate, overview,
 *         voteAverage, mediaType, seasonNumber, seasonName }
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
    const {
      key,
      tmdbId,
      doubanId,
      title,
      posterPath,
      releaseDate,
      overview,
      voteAverage,
      mediaType,
      seasonNumber,
      seasonName,
    } = body;

    // 只验证 key 和 title 是必需的
    if (!key || !title) {
      return NextResponse.json(
        { error: '缺少必要参数 (key 或 title)' },
        { status: 400 }
      );
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
      return NextResponse.json(
        { error: 'OpenList 未配置或未启用' },
        { status: 400 }
      );
    }

    const client = new OpenListClient(
      openListConfig.url,
      openListConfig.username,
      openListConfig.password
    );
    void client; // 保留客户端实例化语义（与源站一致，供后续扩展使用）
    void doubanId; // 预留字段：源站接口接收但暂未使用

    // 读取现有 metainfo (从内存缓存或数据库)
    let metaInfo: MetaInfo | null = getCachedMetaInfo();

    if (!metaInfo) {
      try {
        console.log('[OpenList Correct] 尝试从数据库读取 metainfo');
        const cached = await db.getCache(METAINFO_DB_KEY);

        if (cached) {
          metaInfo = typeof cached === 'string' ? JSON.parse(cached) : (cached as MetaInfo);
        }
      } catch (error) {
        console.error('[OpenList Correct] 从数据库读取 metainfo 失败:', error);
        return NextResponse.json(
          { error: 'metainfo 读取失败' },
          { status: 500 }
        );
      }
    }

    if (!metaInfo) {
      return NextResponse.json(
        { error: 'metainfo.json 不存在' },
        { status: 404 }
      );
    }

    // 检查 key 是否存在
    if (!metaInfo.folders[key]) {
      return NextResponse.json(
        { error: '视频不存在' },
        { status: 404 }
      );
    }

    // 保留原始文件夹名称
    const folderName = metaInfo.folders[key].folderName;

    // 更新视频信息
    metaInfo.folders[key] = {
      folderName: folderName,
      tmdb_id: tmdbId || null,
      title: title,
      poster_path: posterPath,
      release_date: releaseDate || '',
      overview: overview || '',
      vote_average: voteAverage || 0,
      media_type: mediaType,
      last_updated: Date.now(),
      failed: false, // 纠错后标记为成功
      season_number: seasonNumber, // 季度编号(可选)
      season_name: seasonName, // 季度名称(可选)
    };

    // 保存 metainfo 到数据库
    await db.setCache(METAINFO_DB_KEY, JSON.stringify(metaInfo), METAINFO_DB_TTL_SECONDS);

    // 更新内存缓存
    invalidateMetaInfoCache();
    setCachedMetaInfo(metaInfo);

    return NextResponse.json({
      success: true,
      message: '纠错成功',
    });
  } catch (error) {
    console.error('视频纠错失败:', error);
    return NextResponse.json(
      { error: '纠错失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
