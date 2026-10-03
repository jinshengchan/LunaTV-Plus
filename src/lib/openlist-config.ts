// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/app/api/admin/openlist/route.ts (OpenListConfig shape)
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.
/**
 * OpenList 配置桥接层（LunaTV 侧新增，移植自 MoonTVPlus）
 *
 * 源站 MoonTVPlus 在 AdminConfig 上挂载 `OpenListConfig`（PascalCase 字段）；
 * LunaTV 的 AdminConfig 采用 camelCase（如 `DownloadConfig.enabled`），
 * 此处提供 camelCase 的 `OpenListRuntimeConfig` 并已接入 `AdminConfig.openlist`。
 */

import { AdminConfig } from '@/lib/admin.types';
import type { OpenListPathMetaMap } from '@/lib/openlist-path-meta';

/**
 * OpenList 运行时配置（camelCase，LunaTV 风格）
 * 字段语义与源站 `OpenListConfig` 一一对应。
 */
export interface OpenListRuntimeConfig {
  enabled: boolean; // 是否启用私人影库
  url: string; // OpenList 服务地址
  username: string; // OpenList 账号
  password: string; // OpenList 密码
  rootPaths?: string[]; // 扫描根目录（多根）
  offlineDownloadPath?: string; // 离线下载目标目录，默认 '/'
  offlineDownloadUseCustomSource?: boolean; // 离线下载是否使用独立的 OpenList
  offlineDownloadUrl?: string; // 独立离线下载 OpenList 地址
  offlineDownloadUsername?: string;
  offlineDownloadPassword?: string;
  scanInterval?: number; // 定时扫描间隔（分钟），0 表示关闭
  scanMode?: 'torrent' | 'name' | 'hybrid'; // 扫描匹配模式
  disableVideoPreview?: boolean; // 是否禁用视频预览流（直连）
  pathMeta?: OpenListPathMetaMap; // 路径元信息：分类/代理播放/缓存时长
  lastRefreshTime?: number; // 上次刷新时间戳
  resourceCount?: number; // 资源数量统计
}

/**
 * 从 AdminConfig 读取 OpenList 配置。
 */
export function readOpenListConfig(
  config: AdminConfig
): OpenListRuntimeConfig | undefined {
  return config.openlist;
}

/** 写入 OpenList 配置（供管理接口使用） */
export function writeOpenListConfig(
  config: AdminConfig,
  openlist: OpenListRuntimeConfig
): void {
  config.openlist = openlist;
}

/** 首选根目录（兼容只有多根数组的配置） */
export function getPrimaryRootPath(cfg: OpenListRuntimeConfig): string {
  const roots = (cfg.rootPaths || []).filter((p) => typeof p === 'string' && p.trim());
  return roots.length > 0 ? roots[0] : '/';
}
