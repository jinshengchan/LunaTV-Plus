// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/app/api/admin/openlist/route.ts
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.
// NOTE: 本文件为超出任务清单的附加移植（任务要求读源站 admin/openlist 了解配置结构；
// 此处一并提供 LunaTV 版管理接口，供"OpenList 配置"后台卡片调用）。
/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { ensureAdmin } from '@/lib/admin-auth';
import { clearConfigCache, getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { OpenListClient } from '@/lib/openlist.client';
import {
  type OpenListRuntimeConfig,
  readOpenListConfig,
  writeOpenListConfig,
} from '@/lib/openlist-config';
import {
  normalizeOpenListPath,
  normalizePathMetaMap,
  type OpenListPathMetaMap,
} from '@/lib/openlist-path-meta';

export const runtime = 'nodejs';

// NOTE(port): LunaTV 暂无 `@/lib/url` 的 normalizeApiBaseUrl，此处内联等价实现。
function normalizeApiBaseUrl(url: string | undefined | null): string {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '');
}

/**
 * 清理字符串中的 BOM 和其他不可见字符
 */
function cleanPath(path: string): string {
  return normalizeOpenListPath(path);
}

function parsePathMeta(raw: unknown): OpenListPathMetaMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return normalizePathMetaMap(raw as OpenListPathMetaMap);
}

/**
 * POST /api/admin/openlist
 * 保存 OpenList 配置（仅管理员）
 * body: { action: 'save', enabled, url, username, password, rootPaths,
 *         offlineDownloadPath, offlineDownloadUseCustomSource, offlineDownloadUrl,
 *         offlineDownloadUsername, offlineDownloadPassword,
 *         scanInterval, scanMode, disableVideoPreview, pathMeta }
 *
 * NOTE(port): 字段采用 camelCase（LunaTV AdminConfig 风格），与源站 PascalCase 不同；
 * 前端"OpenList 配置"卡片提交时请使用本接口的字段名。
 */
export async function POST(request: NextRequest) {
  // 权限检查：仅管理员可用（LunaTV admin-auth 同款风格）
  try {
    await ensureAdmin(request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '无权限' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const {
      action,
      enabled,
      url,
      username,
      password,
      rootPaths,
      offlineDownloadPath,
      offlineDownloadUseCustomSource,
      offlineDownloadUrl,
      offlineDownloadUsername,
      offlineDownloadPassword,
      scanInterval,
      scanMode,
      disableVideoPreview,
      pathMeta,
    } = body;

    if (action !== 'save') {
      return NextResponse.json({ error: '未知操作' }, { status: 400 });
    }

    // 获取配置
    const adminConfig = await getConfig();

    const cleanedPathMeta = parsePathMeta(pathMeta);
    const normalizedURL = normalizeApiBaseUrl(url);
    const normalizedOfflineDownloadURL = normalizeApiBaseUrl(offlineDownloadUrl);

    const prev = readOpenListConfig(adminConfig);

    const next: OpenListRuntimeConfig = {
      enabled: false,
      url: normalizedURL,
      username: username || '',
      password: password || '',
      rootPaths: Array.isArray(rootPaths) && rootPaths.length > 0 ? rootPaths.map(cleanPath) : ['/'],
      offlineDownloadPath: offlineDownloadPath || '/',
      offlineDownloadUseCustomSource: offlineDownloadUseCustomSource || false,
      offlineDownloadUrl: normalizedOfflineDownloadURL,
      offlineDownloadUsername: offlineDownloadUsername || '',
      offlineDownloadPassword: offlineDownloadPassword || '',
      lastRefreshTime: prev?.lastRefreshTime,
      resourceCount: prev?.resourceCount,
      scanInterval: 0,
      scanMode: scanMode || 'hybrid',
      disableVideoPreview: disableVideoPreview || false,
      pathMeta: cleanedPathMeta,
    };

    // 如果功能未启用，允许保存空配置
    if (!enabled) {
      writeOpenListConfig(adminConfig, next);
      await db.saveAdminConfig(adminConfig);
      clearConfigCache();

      return NextResponse.json({
        success: true,
        message: '保存成功',
      });
    }

    // 功能启用时，验证必填字段
    if (!normalizedURL || !username || !password) {
      return NextResponse.json(
        { error: '请提供 URL、账号和密码' },
        { status: 400 }
      );
    }

    if (
      offlineDownloadUseCustomSource &&
      (!normalizedOfflineDownloadURL ||
        !offlineDownloadUsername ||
        !offlineDownloadPassword)
    ) {
      return NextResponse.json(
        { error: '请提供离线下载 OpenList URL、账号和密码' },
        { status: 400 }
      );
    }

    // 验证 RootPaths
    if (!Array.isArray(rootPaths) || rootPaths.length === 0) {
      return NextResponse.json(
        { error: '请至少提供一个根目录' },
        { status: 400 }
      );
    }

    // 验证扫描间隔
    const parsedScanInterval = parseInt(scanInterval) || 0;
    if (parsedScanInterval > 0 && parsedScanInterval < 60) {
      return NextResponse.json(
        { error: '定时扫描间隔最低为 60 分钟' },
        { status: 400 }
      );
    }

    // 验证账号密码是否正确
    try {
      console.log('[OpenList Config] 验证账号密码');
      await OpenListClient.login(normalizedURL, username, password);
      console.log('[OpenList Config] 账号密码验证成功');
    } catch (error) {
      console.error('[OpenList Config] 账号密码验证失败:', error);
      return NextResponse.json(
        { error: '账号密码验证失败: ' + (error as Error).message },
        { status: 400 }
      );
    }

    if (offlineDownloadUseCustomSource) {
      try {
        console.log('[OpenList Config] 验证离线下载 OpenList 账号密码');
        await OpenListClient.login(
          normalizedOfflineDownloadURL,
          offlineDownloadUsername,
          offlineDownloadPassword
        );
        console.log('[OpenList Config] 离线下载 OpenList 账号密码验证成功');
      } catch (error) {
        console.error('[OpenList Config] 离线下载 OpenList 账号密码验证失败:', error);
        return NextResponse.json(
          { error: '离线下载 OpenList 账号密码验证失败: ' + (error as Error).message },
          { status: 400 }
        );
      }
    }

    next.enabled = true;
    next.scanInterval = parsedScanInterval;

    writeOpenListConfig(adminConfig, next);
    await db.saveAdminConfig(adminConfig);
    clearConfigCache();

    return NextResponse.json({
      success: true,
      message: '保存成功',
    });
  } catch (error) {
    console.error('OpenList 配置操作失败:', error);
    return NextResponse.json(
      { error: '操作失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
