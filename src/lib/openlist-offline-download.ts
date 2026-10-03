// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/lib/openlist-offline-download.ts
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.

import { OpenListClient } from '@/lib/openlist.client';
import type { OpenListRuntimeConfig } from '@/lib/openlist-config';

type OpenListOfflineDownloadSource = {
  url: string;
  username: string;
  password: string;
};

function getOfflineDownloadSource(
  config: OpenListRuntimeConfig
): OpenListOfflineDownloadSource {
  // TODO(port): wire to AdminConfig.openlist — 调用方通过 readOpenListConfig(getConfig()) 传入
  if (!config?.enabled) {
    throw new Error('私人影库功能未启用');
  }

  const useCustomSource = config.offlineDownloadUseCustomSource === true;
  const source = useCustomSource
    ? {
        url: config.offlineDownloadUrl || '',
        username: config.offlineDownloadUsername || '',
        password: config.offlineDownloadPassword || '',
      }
    : {
        url: config.url,
        username: config.username,
        password: config.password,
      };

  if (!source.url || !source.username || !source.password) {
    throw new Error(
      useCustomSource
        ? '离线下载 OpenList 配置不完整'
        : 'OpenList 配置不完整'
    );
  }

  return source;
}

export function getOfflineDownloadBasePath(
  config: OpenListRuntimeConfig
): string {
  const path = config?.offlineDownloadPath || '/';
  const normalizedPath = path.replace(/\/$/, '');
  return normalizedPath || '/';
}

export function joinOpenListPath(basePath: string, name: string): string {
  return basePath === '/' ? `/${name}` : `${basePath}/${name}`;
}

/**
 * 向 OpenList 添加离线下载任务
 * POST {OpenListURL}/api/fs/add_offline_download { path, urls, tool }
 * @param config OpenList 运行时配置（通过 readOpenListConfig(getConfig()) 获取）
 * @param downloadPath OpenList 内的目标保存路径
 * @param url 磁力链 / 种子直链
 * @param tool 下载工具：aria2 | Transmission | qBittorrent
 */
export async function addOpenListOfflineDownload(
  config: OpenListRuntimeConfig,
  downloadPath: string,
  url: string,
  tool: string
) {
  const source = getOfflineDownloadSource(config);
  const client = new OpenListClient(source.url, source.username, source.password);
  const token = await (client as any).getToken();
  const openlistUrl = `${source.url.replace(/\/$/, '')}/api/fs/add_offline_download`;

  const response = await fetch(openlistUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify({
      path: downloadPath,
      urls: [url],
      tool,
    }),
  });

  const data = await response.json();

  if (!response.ok || data.code !== 200) {
    throw new Error(data.message || '添加离线下载任务失败');
  }
}
