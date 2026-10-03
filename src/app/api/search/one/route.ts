import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import {
  executeSavedSourceScript,
  listEnabledSourceScripts,
  normalizeScriptSearchResults,
  normalizeScriptSources,
} from '@/lib/source-script';
import {
  buildResolutionFilterFromSearchParams,
  filterSearchResultsByResolution,
} from '@/lib/video-quality';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

// OrionTV 兼容接口
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const resourceId = searchParams.get('resourceId');
  const resolutionFilter = buildResolutionFilterFromSearchParams(searchParams);

  if (!query || !resourceId) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { result: null, error: '缺少必要参数: q 或 resourceId' },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      }
    );
  }

  const config = await getConfig();
  const apiSites = await getAvailableApiSites(authInfo.username);

  // 实验性：视频源脚本（移植自 MoonTVPlus），resourceId 形如 script:<key>
  const enabledScripts = await listEnabledSourceScripts();
  const matchedScript = enabledScripts.find((item) => `script:${item.key}` === resourceId);
  if (matchedScript) {
    try {
      const sourcesExecution = await executeSavedSourceScript({
        key: matchedScript.key,
        hook: 'getSources',
        payload: {},
      });
      const sources = normalizeScriptSources(sourcesExecution.result);
      const perSource = await Promise.all(
        sources.map(async (source) => {
          const execution = await executeSavedSourceScript({
            key: matchedScript.key,
            hook: 'search',
            payload: { keyword: query, page: 1, sourceId: source.id },
          });
          return normalizeScriptSearchResults({
            scriptKey: matchedScript.key,
            scriptName: matchedScript.name,
            sourceId: source.id,
            sourceName: source.name,
            result: execution.result,
          });
        })
      );
      let scriptResults = perSource.flat().filter((r) => r.title === query);
      if (!config.SiteConfig.DisableYellowFilter) {
        scriptResults = scriptResults.filter((result) => {
          const typeName = result.type_name || '';
          return !yellowWords.some((word: string) => typeName.includes(word));
        });
      }
      scriptResults = filterSearchResultsByResolution(scriptResults, resolutionFilter);
      const cacheTime = await getCacheTime();
      if (scriptResults.length === 0) {
        return NextResponse.json({ error: '未找到结果', result: null }, { status: 404 });
      }
      return NextResponse.json(
        { results: scriptResults },
        {
          headers: {
            'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
            'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
            'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
            'Netlify-Vary': 'query',
          },
        }
      );
    } catch {
      return NextResponse.json({ error: '搜索失败', result: null }, { status: 500 });
    }
  }

  try {
    // 根据 resourceId 查找对应的 API 站点
    const targetSite = apiSites.find((site) => site.key === resourceId);
    if (!targetSite) {
      return NextResponse.json(
        {
          error: `未找到指定的视频源: ${resourceId}`,
          result: null,
        },
        { status: 404 }
      );
    }

    const results = await searchFromApi(targetSite, query);
    let result = results.filter((r) => r.title === query);
    if (!config.SiteConfig.DisableYellowFilter) {
      result = result.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }

    // 分辨率过滤（resolution 已在 downstream 解析阶段装饰）
    result = filterSearchResultsByResolution(result, resolutionFilter);
    const cacheTime = await getCacheTime();

    if (result.length === 0) {
      return NextResponse.json(
        {
          error: '未找到结果',
          result: null,
        },
        { status: 404 }
      );
    } else {
      return NextResponse.json(
        { results: result },
        {
          headers: {
            'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
            'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
            'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
            'Netlify-Vary': 'query',
          },
        }
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: '搜索失败',
        result: null,
      },
      { status: 500 }
    );
  }
}
