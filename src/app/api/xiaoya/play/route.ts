// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/app/api/xiaoya/play/route.ts
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.
/* eslint-disable no-console */
 

import bs58 from 'bs58';
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { DEFAULT_USER_AGENT } from '@/lib/user-agent';
import { getXiaoyaConfig, XiaoyaClient } from '@/lib/xiaoya.client';

export const runtime = 'nodejs';

/**
 * Base58 解码（MoonTVPlus 的 `@/lib/utils` 中 `base58Decode` 的内联移植；
 * LunaTV 的 utils 暂无 base58，依赖 `bs58` 包——已在 package.json 中）。
 */
function base58Decode(encoded: string): string {
  if (!encoded) return '';
  const bytes = bs58.decode(encoded);
  return Buffer.from(bytes).toString('utf-8');
}

/**
 * 使用 HEAD 请求跟随重定向获取最终 URL（直连方法 - 降级使用）
 */
async function getFinalUrl(url: string, maxRedirects = 5): Promise<string> {
  let currentUrl = url;
  let redirectCount = 0;

  while (redirectCount < maxRedirects) {
    try {
      const response = await fetch(currentUrl, {
        method: 'HEAD',
        redirect: 'manual',
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return currentUrl;
        }

        if (location.startsWith('http://') || location.startsWith('https://')) {
          currentUrl = location;
        } else if (location.startsWith('/')) {
          const urlObj = new URL(currentUrl);
          currentUrl = `${urlObj.protocol}//${urlObj.host}${location}`;
        } else {
          const urlObj = new URL(currentUrl);
          const pathParts = urlObj.pathname.split('/');
          pathParts.pop();
          pathParts.push(location);
          currentUrl = `${urlObj.protocol}//${urlObj.host}${pathParts.join('/')}`;
        }

        redirectCount++;
      } else {
        return currentUrl;
      }
    } catch (error) {
      console.error('[xiaoya/play] 获取最终 URL 失败:', error);
      return currentUrl;
    }
  }

  return currentUrl;
}

/**
 * GET /api/xiaoya/play?path=<path>&format=json
 * 获取小雅视频的播放链接（优先使用视频预览流，失败时降级到直连）
 * path参数为base58编码的路径
 * format=json: 返回 JSON 格式（用于 play 页面）
 * 默认: 返回重定向（用于 tvbox 等）
 *
 * 适配说明：MoonTVPlus 使用 `requireFeaturePermission(request, 'xiaoya', ...)` 做细粒度
 * 功能权限校验，LunaTV 暂无 `@/lib/permissions`，此处降级为普通登录校验
 *（与 src/app/api/acg/nyaa/route.ts 一致）。
 */
export async function GET(request: NextRequest) {
  try {
    // 权限检查：需要登录
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const encodedPath = searchParams.get('path');
    const format = searchParams.get('format'); // 新增 format 参数

    if (!encodedPath) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    // 对path进行base58解码
    const path = base58Decode(encodedPath);

    const config = await getConfig();
    // TODO(port): wire to AdminConfig.xiaoya — 需在 src/lib/admin.types.ts 的 AdminConfig 中补 XiaoyaConfig 字段
    const xiaoyaConfig = getXiaoyaConfig(config);

    if (!xiaoyaConfig) {
      return NextResponse.json({ error: '小雅未配置或未启用' }, { status: 400 });
    }

    const client = new XiaoyaClient(
      xiaoyaConfig.ServerURL,
      xiaoyaConfig.Username,
      xiaoyaConfig.Password,
      xiaoyaConfig.Token
    );

    // 如果启用了禁用预览视频，直接使用直连方法
    if (xiaoyaConfig.DisableVideoPreview) {
      const playUrl = await client.getDownloadUrl(path);

      // 如果指定了 format=json，使用 getFinalUrl 并返回 JSON
      if (format === 'json') {
        const finalUrl = await getFinalUrl(playUrl);

        // 检查URL是否为空
        if (!finalUrl || finalUrl.trim() === '') {
          throw new Error('获取到的播放链接为空');
        }

        return NextResponse.json({ url: finalUrl });
      }

      // 检查URL是否为空
      if (!playUrl || playUrl.trim() === '') {
        throw new Error('获取到的播放链接为空');
      }

      // 默认返回重定向（用于 tvbox）
      return NextResponse.redirect(playUrl);
    }

    // 优先尝试视频预览流方法
    try {
      const token = await client.getToken();

      const response = await fetch(`${xiaoyaConfig.ServerURL}/api/fs/other`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token,
        },
        body: JSON.stringify({
          path: path,
          method: 'video_preview',
          password: '',
        }),
      });

      if (!response.ok) {
        throw new Error(`视频预览请求失败: ${response.status}`);
      }

      const data = await response.json();

      if (data.code !== 200) {
        throw new Error(`视频预览失败: ${data.message}`);
      }

      const taskList = data.data?.video_preview_play_info?.live_transcoding_task_list;
      if (!taskList || taskList.length === 0) {
        throw new Error('未找到可用的播放链接');
      }

      const qualityOrder: Record<string, number> = {
        'FHD': 1,
        'HD': 2,
        'LD': 3,
        'SD': 4,
      };

      const qualities = taskList
        .filter((task: any) => task.status === 'finished')
        .map((task: any) => ({
          name: task.template_id,
          url: task.url,
        }))
        .filter((quality: any) => quality.url && quality.url.trim() !== '') // 过滤空URL
        .sort((a: any, b: any) => (qualityOrder[a.name] || 999) - (qualityOrder[b.name] || 999));

      if (qualities.length === 0) {
        throw new Error('未找到已完成的播放链接');
      }

      // 如果指定了 format=json，返回 JSON 格式
      if (format === 'json') {
        return NextResponse.json({
          url: qualities[0].url,
          qualities
        });
      }

      // 默认返回重定向（用于 tvbox）
      return NextResponse.redirect(qualities[0].url);
    } catch (error) {
      // 视频预览流失败，降级到直连方法
      console.log('[xiaoya/play] 视频预览流失败，降级到直连方法:', (error as Error).message);

      const playUrl = await client.getDownloadUrl(path);

      // 如果指定了 format=json，使用 getFinalUrl 并返回 JSON
      if (format === 'json') {
        const finalUrl = await getFinalUrl(playUrl);

        // 检查URL是否为空
        if (!finalUrl || finalUrl.trim() === '') {
          throw new Error('获取到的播放链接为空');
        }

        return NextResponse.json({ url: finalUrl });
      }

      // 检查URL是否为空
      if (!playUrl || playUrl.trim() === '') {
        throw new Error('获取到的播放链接为空');
      }

      // 默认返回重定向（用于 tvbox）
      return NextResponse.redirect(playUrl);
    }
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
