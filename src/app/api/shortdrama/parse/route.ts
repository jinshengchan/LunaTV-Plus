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

    if (!id || !episode) {
      const errorResponse = { error: '缺少必要参数: id, episode' };
      const responseSize = Buffer.byteLength(JSON.stringify(errorResponse), 'utf8');

      recordRequest({
        timestamp: startTime,
        method: 'GET',
        path: '/api/shortdrama/parse',
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
    const episodeNum = parseInt(episode);

    if (isNaN(videoId) || isNaN(episodeNum)) {
      const errorResponse = { error: '参数格式错误' };
      const responseSize = Buffer.byteLength(JSON.stringify(errorResponse), 'utf8');

      recordRequest({
        timestamp: startTime,
        method: 'GET',
        path: '/api/shortdrama/parse',
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
    } catch (configError) {
      console.error('读取短剧配置失败:', configError);
      // 配置读取失败时，不使用备用API
      alternativeApiUrl = undefined;
    }

    // 解析视频：优先备用 API（已配置时），否则服务端直调上游资源站。
    // 注意：不再调用 parseShortDramaEpisode——它内部用相对路径 fetch 本路由，
    // 服务端调用会导致循环调用 + Failed to parse URL。
    let url = '';
    let parsedUrl = '';
    let proxyUrl = '';
    let title = '';
    let totalEpisodes = 1;

    if (name && alternativeApiUrl) {
      try {
        const altResult = await parseWithAlternativeApi(
          name,
          episodeNum,
          alternativeApiUrl
        );
        if (altResult.code === 0 && altResult.data) {
          const ep = altResult.data.episode;
          parsedUrl = ep?.parsedUrl || altResult.data.parsedUrl || '';
          proxyUrl = altResult.data.proxyUrl || '';
          url = proxyUrl || parsedUrl;
          title = altResult.data.videoName || '';
          totalEpisodes = altResult.data.totalEpisodes || 1;
        }
      } catch (altErr) {
        console.warn('[shortdrama/parse] 备用 API 失败，fallback 到上游资源站:', altErr);
      }
    }

    if (!url) {
      const vod = await fetchShortDramaVod(videoId);
      if (vod && vod.episodeUrls.length > 0) {
        // episode 为播放页传来的 0-based 分集索引，钳制到有效范围
        const idx = Math.min(
          Math.max(episodeNum, 0),
          vod.episodeUrls.length - 1
        );
        parsedUrl = vod.episodeUrls[idx] || '';
        url = parsedUrl;
        title = vod.vodName;
        totalEpisodes = vod.episodeUrls.length;
      }
    }

    if (!url) {
      const errorResponse = { error: '解析失败' };
      const responseSize = Buffer.byteLength(JSON.stringify(errorResponse), 'utf8');

      recordRequest({
        timestamp: startTime,
        method: 'GET',
        path: '/api/shortdrama/parse',
        statusCode: 400,
        duration: Date.now() - startTime,
        memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
        dbQueries: getDbQueryCount(),
        requestSize: 0,
        responseSize,
      });

      return NextResponse.json(errorResponse, { status: 400 });
    }

    // 返回视频URL，优先使用代理URL避免CORS问题
    const response = {
      url: proxyUrl || parsedUrl, // 优先使用代理URL
      originalUrl: parsedUrl,
      proxyUrl: proxyUrl,
      title: title,
      episode: episodeNum,
      totalEpisodes: totalEpisodes,
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
      path: '/api/shortdrama/parse',
      statusCode: 200,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: getDbQueryCount(),
      requestSize: 0,
      responseSize,
    });

    return finalResponse;
  } catch (error) {
    console.error('短剧解析失败:', error);

    const errorResponse = { error: '服务器内部错误' };
    const responseSize = Buffer.byteLength(JSON.stringify(errorResponse), 'utf8');

    recordRequest({
      timestamp: startTime,
      method: 'GET',
      path: '/api/shortdrama/parse',
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