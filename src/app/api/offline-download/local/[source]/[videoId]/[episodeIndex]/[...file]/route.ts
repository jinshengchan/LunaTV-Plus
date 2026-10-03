// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/app/api/offline-download/local/[source]/[videoId]/[episodeIndex]/[...file]/route.ts
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.

/**
 * 本地下载视频播放代理 API - 动态路由版本（含 Range 支持）
 * 路径格式: /api/offline-download/local/[source]/[videoId]/[episodeIndex]/[file]
 *
 * - playlist.m3u8：返回改写后的 m3u8，片段/Key URL 指向本路由
 * - ts/key 文件：支持 HTTP Range 请求（播放器 seek 时需要）
 */

import * as fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import * as path from 'path';

import { getAuthInfoFromCookie } from '@/lib/auth';

export const runtime = 'nodejs';

// 检查是否启用离线下载功能
const OFFLINE_DOWNLOAD_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD === 'true';
const OFFLINE_DOWNLOAD_DIR =
  process.env.OFFLINE_DOWNLOAD_DIR ||
  path.join(process.cwd(), 'data', 'offline-download');

/**
 * 检查用户权限（仅管理员和站长）
 */
function checkPermission(request: NextRequest): boolean {
  if (!OFFLINE_DOWNLOAD_ENABLED) {
    return false;
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return false;
  }

  // 只有管理员和站长可以访问
  return authInfo.role === 'owner' || authInfo.role === 'admin';
}

function contentTypeOf(fileName: string): string {
  if (fileName.endsWith('.ts')) return 'video/mp2t';
  if (fileName.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  return 'application/octet-stream';
}

/**
 * GET - 代理本地视频文件（动态路由）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ source: string; videoId: string; episodeIndex: string; file: string[] }> }
) {
  if (!checkPermission(request)) {
    return NextResponse.json({ error: '无权限' }, { status: 403 });
  }

  try {
    const { source, videoId, episodeIndex, file } = await params;
    const fileName = file.join('/'); // 支持嵌套路径

    if (!source || !videoId || !episodeIndex || !fileName) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 });
    }

    // 拒绝明显非法的路径成分（额外保险，路径归一化检查随后也会执行）
    if (fileName.includes('..')) {
      return NextResponse.json({ error: '非法路径' }, { status: 403 });
    }

    // 构建文件路径
    const downloadDir = path.join(
      OFFLINE_DOWNLOAD_DIR,
      source,
      videoId,
      `ep${parseInt(episodeIndex, 10) + 1}`
    );
    const filePath = path.join(downloadDir, fileName);

    // 安全检查：确保文件路径在下载目录内
    const normalizedFilePath = path.normalize(filePath);
    const normalizedDownloadDir = path.normalize(downloadDir);
    if (!normalizedFilePath.startsWith(normalizedDownloadDir)) {
      return NextResponse.json({ error: '非法路径' }, { status: 403 });
    }

    // 检查文件是否存在
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    // 如果是 m3u8 文件，需要修改内容使片段指向代理地址
    if (fileName === 'playlist.m3u8') {
      let content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const modifiedLines: string[] = [];

      for (const line of lines) {
        const trimmedLine = line.trim();

        // 处理 Key URI
        if (trimmedLine.startsWith('#EXT-X-KEY:')) {
          const modifiedLine = trimmedLine.replace(
            /URI="([^"]+)"/,
            `URI="/api/offline-download/local/${encodeURIComponent(source)}/${encodeURIComponent(videoId)}/${encodeURIComponent(episodeIndex)}/$1"`
          );
          modifiedLines.push(modifiedLine);
        }
        // 处理 ts 片段
        else if (trimmedLine && !trimmedLine.startsWith('#')) {
          modifiedLines.push(
            `/api/offline-download/local/${encodeURIComponent(source)}/${encodeURIComponent(videoId)}/${encodeURIComponent(episodeIndex)}/${encodeURIComponent(trimmedLine)}`
          );
        } else {
          modifiedLines.push(line);
        }
      }

      content = modifiedLines.join('\n');

      return new NextResponse(content, {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // 其他文件（ts、key 等）：支持 Range 请求
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const contentType = contentTypeOf(fileName);
    const range = request.headers.get('range');

    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      if (match) {
        let start = match[1] ? parseInt(match[1], 10) : 0;
        let end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

        if (isNaN(start) || isNaN(end) || start >= fileSize || start > end) {
          return new NextResponse(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${fileSize}` },
          });
        }

        end = Math.min(end, fileSize - 1);
        const chunkSize = end - start + 1;
        const fileStream = fs.createReadStream(filePath, { start, end });

        return new NextResponse(fileStream as unknown as ReadableStream, {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize.toString(),
            'Cache-Control': 'public, max-age=31536000',
          },
        });
      }
    }

    // 完整返回（使用流式读取，避免大文件占内存）
    const fileStream = fs.createReadStream(filePath);
    return new NextResponse(fileStream as unknown as ReadableStream, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileSize.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    console.error('[OfflineDownload] 代理本地文件失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '代理失败' },
      { status: 500 }
    );
  }
}
