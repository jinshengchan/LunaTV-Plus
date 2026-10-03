// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/app/api/openlist/list/route.ts
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.
/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  getCachedMetaInfo,
  MetaInfo,
  setCachedMetaInfo,
} from '@/lib/openlist-cache';
import { readOpenListConfig } from '@/lib/openlist-config';
import {
  listPathMetaCategories,
  resolvePathMeta,
} from '@/lib/openlist-path-meta';

export const runtime = 'nodejs';

// TODO(port): 源站从 `@/lib/tmdb.search` 导入 getTMDBImageUrl；LunaTV 的
// tmdb.client.ts 暂无等价导出，此处内联最小实现。
function getTMDBImageUrl(path: string | null, size = 'w500'): string {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `https://image.tmdb.org/t/p/${size}${path.startsWith('/') ? path : `/${path}`}`;
}

// TODO(port): 源站使用 db.getGlobalValue('video.metainfo') 持久化元数据；
// LunaTV 暂无该接口，此处用 db 缓存代替（注意缓存可能过期，大数据量请接入持久化存储）。
const METAINFO_DB_KEY = 'openlist:video.metainfo';

async function readMetaInfoFromDb(): Promise<MetaInfo | null> {
  const cached = await db.getCache(METAINFO_DB_KEY);
  if (!cached) return null;
  if (typeof cached === 'string') {
    return JSON.parse(cached) as MetaInfo;
  }
  return cached as MetaInfo;
}

/**
 * GET /api/openlist/list?page=1&pageSize=20&includeFailed=false&noCache=false&category=
 * 获取私人影库视频列表
 * category: 分类名；__none__ 表示未分类
 */
export async function GET(request: NextRequest) {
  try {
    // 权限检查：需要登录（LunaTV nyaa 路由同款风格）
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    // TODO(port): 源站此处还有 requireFeaturePermission(request, 'private_library') 功能权限校验；
    // LunaTV 暂无该权限体系，如需限制请在此接入。

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const includeFailed = searchParams.get('includeFailed') === 'true';
    const noCache = searchParams.get('noCache') === 'true';
    const categoryFilter = (searchParams.get('category') || '').trim();

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
        { error: 'OpenList 未配置或未启用', list: [], total: 0, categories: [] },
        { status: 200 }
      );
    }

    const pathMeta = openListConfig.pathMeta;
    const categories = listPathMetaCategories(pathMeta);

    // 读取 metainfo (从内存缓存或数据库)
    let metaInfo: MetaInfo | null = null;

    if (!noCache) {
      metaInfo = getCachedMetaInfo();
    }

    if (!metaInfo) {
      try {
        const stored = await readMetaInfoFromDb();

        if (stored) {
          // 验证数据结构
          if (!stored || typeof stored !== 'object') {
            throw new Error('metaInfo 不是有效对象');
          }
          if (!stored.folders || typeof stored.folders !== 'object') {
            throw new Error('metaInfo.folders 不存在或不是对象');
          }
          metaInfo = stored;

          // 只有在不是 noCache 模式时才更新内存缓存
          if (!noCache) {
            setCachedMetaInfo(metaInfo);
          }
        } else {
          throw new Error('数据库中没有 metainfo 数据');
        }
      } catch (error) {
        console.error('[OpenList List] 从数据库读取 metainfo 失败:', error);
        return NextResponse.json(
          {
            error: 'metainfo 读取失败',
            details: (error as Error).message,
            list: [],
            total: 0,
            categories,
          },
          { status: 200 }
        );
      }
    }

    if (!metaInfo) {
      return NextResponse.json(
        { error: '无数据', list: [], total: 0, categories },
        { status: 200 }
      );
    }

    // 验证 metaInfo 结构
    if (!metaInfo.folders || typeof metaInfo.folders !== 'object') {
      return NextResponse.json(
        { error: 'metainfo.json 结构无效', list: [], total: 0, categories },
        { status: 200 }
      );
    }

    // 转换为数组并分页
    let allVideos = Object.entries(metaInfo.folders)
      .filter(([, info]) => includeFailed || !info.failed)
      .map(([key, info]) => {
        const pathMetaResolved = resolvePathMeta(info.folderName, pathMeta);
        return {
          id: key,
          folder: info.folderName,
          tmdbId: info.tmdb_id,
          title: info.title,
          poster: getTMDBImageUrl(info.poster_path),
          releaseDate: info.release_date,
          overview: info.overview,
          voteAverage: info.vote_average,
          mediaType: info.media_type,
          lastUpdated: info.last_updated,
          failed: info.failed || false,
          seasonNumber: info.season_number,
          seasonName: info.season_name,
          category: pathMetaResolved.category,
          refresh14m: pathMetaResolved.refresh14m,
        };
      });

    // 分类筛选（完全匹配 PathMeta 后的 category）
    if (categoryFilter) {
      if (categoryFilter === '__none__') {
        allVideos = allVideos.filter((v) => !v.category);
      } else {
        allVideos = allVideos.filter((v) => v.category === categoryFilter);
      }
    }

    // 按更新时间倒序排序
    allVideos.sort((a, b) => b.lastUpdated - a.lastUpdated);

    const total = allVideos.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const list = allVideos.slice(start, end);

    return NextResponse.json({
      success: true,
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      categories,
    });
  } catch (error) {
    console.error('获取视频列表失败:', error);
    return NextResponse.json(
      {
        error: '获取失败',
        details: (error as Error).message,
        list: [],
        total: 0,
        categories: [],
      },
      { status: 500 }
    );
  }
}
