/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getCacheTime, getConfig } from '@/lib/config';
import { parseWithAlternativeApi } from '@/lib/shortdrama.client';
import { fetchShortDramaVod } from '@/lib/shortdrama.server';
import { recordRequest, getDbQueryCount, resetDbQueryCount } from '@/lib/performance-monitor';

// 标记为动态路由
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;
  resetDbQueryCount();

  try {
    const { searchParams } = request.nextUrl;
    const id = searchParams.get('id');
    const episode = searchParams.get('episode');
    const name = searchParams.get('name'); // 可选：用于备用API

    if (!id) {
      const errorResponse = { error: '缺少必要参数: id' };
      const responseSize = Buffer.byteLength(JSON.stringify(errorResponse), 'utf8');

      recordRequest({
        timestamp: startTime,
        method: 'GET',
        path: '/api/shortdrama/detail',
        statusCode: 400,
        duration: Date.now() - startTime,
        memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
        dbQueries: getDbQueryCount(),
        requestSize: 0,
        responseSize,
      });

      return NextResponse.json(errorResponse, { status: 400 });
    }

    const videoId = parseInt(id);
    const episodeNum = episode ? parseInt(episode) : 1;

    if (isNaN(videoId) || isNaN(episodeNum)) {
      const errorResponse = { error: '参数格式错误' };
      const responseSize = Buffer.byteLength(JSON.stringify(errorResponse), 'utf8');

      recordRequest({
        timestamp: startTime,
        method: 'GET',
        path: '/api/shortdrama/detail',
        statusCode: 400,
        duration: Date.now() - startTime,
        memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
        dbQueries: getDbQueryCount(),
        requestSize: 0,
        responseSize,
      });

      return NextResponse.json(errorResponse, { status: 400 });
    }

    // 读取配置以获取备用API地址
    let alternativeApiUrl: string | undefined;
    try {
      const config = await getConfig();
      const shortDramaConfig = config.ShortDramaConfig;
      alternativeApiUrl = shortDramaConfig?.enableAlternative ? shortDramaConfig.alternativeApiUrl : undefined;

      // 调试日志
      console.log('[ShortDrama Detail] 配置读取:', {
        hasConfig: !!shortDramaConfig,
        enableAlternative: shortDramaConfig?.enableAlternative,
        hasAlternativeUrl: !!alternativeApiUrl,
        name: name,
      });
    } catch (configError) {
      console.error('读取短剧配置失败:', configError);
      // 配置读取失败时，不使用备用API
      alternativeApiUrl = undefined;
    }

    // 先尝试备用 API（已配置时），否则服务端直调上游资源站拿分集数。
    // 注意：不再调用 parseShortDramaEpisode——它内部用相对路径 fetch 解析路由，
    // 服务端调用会导致循环调用 + Failed to parse URL。
    let videoName = '';
    let cover = '';
    let description = '';
    let totalEpisodes = 0;

    if (name && alternativeApiUrl) {
      try {
        const altResult = await parseWithAlternativeApi(
          name,
          episodeNum,
          alternativeApiUrl
        );
        if (altResult.code === 0 && altResult.data) {
          videoName = altResult.data.videoName || '';
          cover = altResult.data.cover || '';
          description = altResult.data.description || '';
          totalEpisodes = altResult.data.totalEpisodes || 0;
        }
      } catch (altErr) {
        console.warn(
          '[shortdrama/detail] 备用 API 失败，fallback 到上游资源站:',
          altErr
        );
      }
    }

    if (totalEpisodes <= 0) {
      const vod = await fetchShortDramaVod(videoId);
      if (vod) {
        videoName = vod.vodName;
        cover = vod.cover;
        description = vod.description;
        totalEpisodes = vod.episodeUrls.length;
      }
    }

    if (totalEpisodes <= 0) {
      const errorResponse = { error: '解析失败' };
      const responseSize = Buffer.byteLength(JSON.stringify(errorResponse), 'utf8');

      recordRequest({
        timestamp: startTime,
        method: 'GET',
        path: '/api/shortdrama/detail',
        statusCode: 400,
        duration: Date.now() - startTime,
        memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
        dbQueries: getDbQueryCount(),
        requestSize: 0,
        responseSize,
      });

      return NextResponse.json(errorResponse, { status: 400 });
    }

    // 转换为兼容格式
    // 注意：始终使用请求的原始ID（主API的ID），不使用备用API的ID
    const response: any = {
      id: id, // 使用原始请求ID，保持一致性
      title: videoName,
      poster: cover,
      episodes: Array.from({ length: totalEpisodes }, (_, i) =>
        `shortdrama:${id}:${i}` // 使用原始请求ID
      ),
      episodes_titles: Array.from({ length: totalEpisodes }, (_, i) =>
        `第${i + 1}集`
      ),
      source: 'shortdrama',
      source_name: '短剧',
      year: new Date().getFullYear().toString(),
      desc: description,
      type_name: '短剧',
      drama_name: videoName, // 添加剧名，用于备用API fallback
    };

    // 设置与豆瓣一致的缓存策略
    const cacheTime = await getCacheTime();
    const finalResponse = NextResponse.json(response);
    finalResponse.headers.set('Cache-Control', `public, max-age=${cacheTime}, s-maxage=${cacheTime}`);
    finalResponse.headers.set('CDN-Cache-Control', `public, s-maxage=${cacheTime}`);
    finalResponse.headers.set('Vercel-CDN-Cache-Control', `public, s-maxage=${cacheTime}`);
    finalResponse.headers.set('Netlify-Vary', 'query');

    // 记录性能指标
    const responseSize = Buffer.byteLength(JSON.stringify(response), 'utf8');
    recordRequest({
      timestamp: startTime,
      method: 'GET',
      path: '/api/shortdrama/detail',
      statusCode: 200,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: getDbQueryCount(),
      requestSize: 0,
      responseSize,
    });

    return finalResponse;
  } catch (error) {
    console.error('短剧详情获取失败:', error);

    const errorResponse = { error: '服务器内部错误' };
    const responseSize = Buffer.byteLength(JSON.stringify(errorResponse), 'utf8');

    recordRequest({
      timestamp: startTime,
      method: 'GET',
      path: '/api/shortdrama/detail',
      statusCode: 500,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: getDbQueryCount(),
      requestSize: 0,
      responseSize,
    });

    return NextResponse.json(errorResponse, { status: 500 });
  }
}