/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { getConfig } from './config';
import { DEFAULT_USER_AGENT } from './user-agent';
import { ShortDramaItem } from './types';

// 短剧相关分类关键词（父分类 + 子分类标签）
const SHORT_DRAMA_KEYWORDS = ['短剧', '女频恋爱', '反转爽剧', '古装仙侠', '年代穿越', '脑洞悬疑', '现代都市'];

// 从单个短剧源获取数据（通过分类名称查找）
async function fetchFromShortDramaSource(
  api: string,
  size: number
): Promise<ShortDramaItem[]> {
  // Step 1: 获取分类列表，找到短剧相关分类的ID
  const listUrl = `${api}?ac=list`;

  const listResponse = await fetch(listUrl, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!listResponse.ok) {
    throw new Error(`HTTP error! status: ${listResponse.status}`);
  }

  const listData = await listResponse.json();
  const categories = listData.class || [];

  // 查找短剧相关分类（父分类"短剧"或子分类标签）
  const shortDramaCategories = categories.filter((cat: any) =>
    cat.type_name && SHORT_DRAMA_KEYWORDS.some((kw: string) => cat.type_name.includes(kw))
  );

  if (shortDramaCategories.length === 0) {
    console.log(`该源没有短剧分类`);
    return [];
  }

  // 优先用父分类"短剧"，没有则用第一个匹配的子分类
  const primaryCategory = shortDramaCategories.find((cat: any) => cat.type_name === '短剧')
    || shortDramaCategories[0];
  const categoryId = primaryCategory.type_id;
  console.log(`找到短剧分类ID: ${categoryId} (${primaryCategory.type_name})`);

  // Step 2: 获取该分类的短剧列表
  const apiUrl = `${api}?ac=detail&t=${categoryId}&pg=1`;

  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  const items = data.list || [];

  return items.slice(0, size).map((item: any) => ({
    id: item.vod_id,
    name: item.vod_name,
    cover: item.vod_pic || '',
    update_time: item.vod_time || new Date().toISOString(),
    score: parseFloat(item.vod_score) || 0,
    episode_count: parseInt(item.vod_remarks?.replace(/[^\d]/g, '') || '1'),
    description: item.vod_content || item.vod_blurb || '',
    author: item.vod_actor || '',
    backdrop: item.vod_pic_slide || item.vod_pic || '',
    vote_average: parseFloat(item.vod_score) || 0,
  }));
}

// 服务端专用函数，从所有短剧源聚合数据
export async function getRecommendedShortDramas(
  category?: number,
  size = 10
): Promise<ShortDramaItem[]> {
  try {
    // 获取配置
    const config = await getConfig();

    // 筛选出所有启用的短剧源
    const shortDramaSources = config.SourceConfig.filter(
      source => source.type === 'shortdrama' && !source.disabled
    );

    console.log(`📺 找到 ${shortDramaSources.length} 个配置的短剧源`);

    // 如果没有配置短剧源，使用默认源
    if (shortDramaSources.length === 0) {
      console.log('📺 使用默认短剧源');
      return await fetchFromShortDramaSource(
        'https://tyyszyapi.com/api.php/provide/vod',
        size
      );
    }

    // 有配置短剧源，聚合所有源的数据
    console.log('📺 聚合多个短剧源的数据');
    const results = await Promise.allSettled(
      shortDramaSources.map(source => {
        console.log(`🔄 请求短剧源: ${source.name}`);
        return fetchFromShortDramaSource(source.api, size);
      })
    );

    // 合并所有成功的结果
    const allItems: ShortDramaItem[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        console.log(`✅ ${shortDramaSources[index].name}: 获取到 ${result.value.length} 条数据`);
        allItems.push(...result.value);
      } else {
        console.error(`❌ ${shortDramaSources[index].name}: 请求失败`, result.reason);
      }
    });

    // 去重（根据名称）
    const uniqueItems = Array.from(
      new Map(allItems.map(item => [item.name, item])).values()
    );

    // 按更新时间排序
    uniqueItems.sort((a, b) =>
      new Date(b.update_time).getTime() - new Date(a.update_time).getTime()
    );

    // 返回指定数量
    const finalItems = uniqueItems.slice(0, size);
    console.log(`📊 最终返回 ${finalItems.length} 条短剧数据`);

    return finalItems;
  } catch (error) {
    console.error('获取短剧推荐失败:', error);
    // 出错时fallback到默认源
    try {
      console.log('⚠️ 出错，fallback到默认源');
      return await fetchFromShortDramaSource(
        'https://tyyszyapi.com/api.php/provide/vod',
        size
      );
    } catch (fallbackError) {
      console.error('默认源也失败:', fallbackError);
      return [];
    }
  }
}

export const DEFAULT_SHORTDRAMA_API =
  'https://tyyszyapi.com/api.php/provide/vod';

/** 获取启用的短剧上游 API 列表（配置源 + 默认源兜底） */
export async function getShortDramaApiList(): Promise<string[]> {
  try {
    const config = await getConfig();
    const apis = ((config.SourceConfig || []) as any[])
      .filter((s) => s.type === 'shortdrama' && !s.disabled && s.api)
      .map((s) => s.api as string);
    if (!apis.includes(DEFAULT_SHORTDRAMA_API)) {
      apis.push(DEFAULT_SHORTDRAMA_API);
    }
    return apis;
  } catch {
    return [DEFAULT_SHORTDRAMA_API];
  }
}

export interface ShortDramaVodInfo {
  api: string;
  vodId: number;
  vodName: string;
  cover: string;
  description: string;
  /** 按集数顺序的直链（取第一组播放源） */
  episodeUrls: string[];
}

/** 解析资源站 vod_play_url：取第一组，按 # 分集、$ 取直链 */
function parseVodPlayUrl(vodPlayUrl: string): string[] {
  if (!vodPlayUrl) return [];
  const firstGroup = vodPlayUrl.split('$$$')[0] || '';
  return firstGroup
    .split('#')
    .map((part) => {
      const idx = part.indexOf('$');
      const url = (idx >= 0 ? part.slice(idx + 1) : part).trim();
      return url;
    })
    .filter((u) => /^https?:\/\//i.test(u));
}

/**
 * 直调上游资源站 ?ac=detail&ids= 获取短剧分集直链。
 * 依次尝试各配置源，拿到有效分集即返回；全部失败返回 null。
 *
 * 背景：shortdrama.client.ts 的 parseShortDramaEpisode 在内部用相对路径
 * fetch('/api/shortdrama/parse')，而 /api/shortdrama/parse 与 /api/shortdrama/detail
 * 两个服务端路由又反过来调用它，导致服务端循环调用、相对 URL 解析失败，
 * 短剧详情/解析在未配置备用 API 时永远失败。此处改为服务端直接请求上游。
 */
export async function fetchShortDramaVod(
  videoId: number
): Promise<ShortDramaVodInfo | null> {
  const apis = await getShortDramaApiList();
  for (const api of apis) {
    try {
      const res = await fetch(`${api}?ac=detail&ids=${videoId}`, {
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const vod = data?.list?.[0];
      if (!vod) continue;
      const episodeUrls = parseVodPlayUrl(vod.vod_play_url || '');
      if (episodeUrls.length === 0) continue;
      return {
        api,
        vodId: videoId,
        vodName: vod.vod_name || '',
        cover: vod.vod_pic || '',
        description: vod.vod_content || vod.vod_blurb || '',
        episodeUrls,
      };
    } catch (err) {
      console.warn(`[shortdrama] 上游 ${api} 获取详情失败:`, err);
    }
  }
  return null;
}
