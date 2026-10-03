// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/app/api/offline-download/route.ts
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.

/**
 * 服务器离线下载任务管理 API
 *
 * GET    /api/offline-download                  获取任务列表
 * GET    /api/offline-download?action=check&source=..&videoId=..&episodeIndex=..
 *        检查某集是否已下载
 * POST   /api/offline-download                  创建任务并开始下载
 * DELETE /api/offline-download?taskId=..        删除任务（含文件）
 * PUT    /api/offline-download?taskId=..&action=retry   重试任务（断点续传）
 *
 * 任务持久化在 OFFLINE_DOWNLOAD_DIR/tasks.json 中，重启后进行中任务标记为 paused。
 */

import * as fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import * as path from 'path';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  OfflineDownloader,
  OfflineDownloadTask,
} from '@/lib/server-offline-downloader';

export const runtime = 'nodejs';

// 检查是否启用离线下载功能
const OFFLINE_DOWNLOAD_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD === 'true';
// LunaTV 惯例：可写数据目录默认放在 <cwd>/data 下（见 src/lib/sqlite.db.ts）
const OFFLINE_DOWNLOAD_DIR =
  process.env.OFFLINE_DOWNLOAD_DIR ||
  path.join(process.cwd(), 'data', 'offline-download');
// TODO: 代理功能暂未实现（LunaTV 无 safe-http 等价物），变量保留供将来接入
const OFFLINE_DOWNLOAD_PROXY = process.env.OFFLINE_DOWNLOAD_PROXY || '';

// 全局下载器实例
let downloader: OfflineDownloader | null = null;

// 任务存储（内存中）
const tasks = new Map<string, OfflineDownloadTask>();

// 活跃的下载Promise
const activeDownloads = new Map<string, Promise<void>>();

// 任务持久化文件路径
const TASKS_FILE = path.join(OFFLINE_DOWNLOAD_DIR, 'tasks.json');

/**
 * 保存任务到文件
 */
function saveTasks(): void {
  try {
    const tasksArray = Array.from(tasks.values()).map((task) => ({
      ...task,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    }));

    // 确保目录存在
    const dir = path.dirname(TASKS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasksArray, null, 2), 'utf-8');
  } catch (error) {
    console.error('[OfflineDownload] 保存任务失败:', error);
  }
}

/**
 * 从文件加载任务
 */
function loadTasks(): void {
  try {
    if (!fs.existsSync(TASKS_FILE)) {
      return;
    }

    const content = fs.readFileSync(TASKS_FILE, 'utf-8');
    const tasksArray = JSON.parse(content);
    console.log(`[OfflineDownload] 从文件读取到 ${tasksArray.length} 个任务`);

    for (const taskData of tasksArray) {
      const task: OfflineDownloadTask = {
        ...taskData,
        createdAt: new Date(taskData.createdAt),
        updatedAt: new Date(taskData.updatedAt),
      };

      // 如果任务在下载或等待中，说明服务器重启了，将状态改为暂停
      if (task.status === 'downloading' || task.status === 'pending') {
        task.status = 'paused';
        task.errorMessage = '服务器重启，任务已暂停';
      }

      tasks.set(task.id, task);
    }

    console.log(`[OfflineDownload] 已加载 ${tasks.size} 个离线下载任务到内存`);
  } catch (error) {
    console.error('[OfflineDownload] 加载任务失败:', error);
  }
}

function getDownloader(): OfflineDownloader {
  if (!downloader) {
    downloader = new OfflineDownloader(OFFLINE_DOWNLOAD_DIR, OFFLINE_DOWNLOAD_PROXY);
    // 首次初始化时加载已保存的任务
    loadTasks();
  }

  return downloader;
}

function serializeTask(task: OfflineDownloadTask) {
  return {
    ...task,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

/**
 * 检查用户权限（仅管理员和站长）
 */
function checkPermission(request: NextRequest): { ok: boolean; status: number; error?: string } {
  if (!OFFLINE_DOWNLOAD_ENABLED) {
    return { ok: false, status: 403, error: '离线下载功能未启用' };
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return { ok: false, status: 401, error: '未登录' };
  }

  // 只有管理员和站长可以使用
  if (authInfo.role !== 'owner' && authInfo.role !== 'admin') {
    return { ok: false, status: 403, error: '无权限，仅管理员可用' };
  }

  return { ok: true, status: 200 };
}

function deny(permission: { status: number; error?: string }) {
  return NextResponse.json({ error: permission.error || '无权限' }, { status: permission.status });
}

/**
 * GET - 获取任务列表或检查下载状态
 */
export async function GET(request: NextRequest) {
  const permission = checkPermission(request);
  if (!permission.ok) {
    return deny(permission);
  }

  // 确保下载器已初始化（这会触发任务加载）
  getDownloader();

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  // 检查视频是否已下载
  if (action === 'check') {
    const source = searchParams.get('source');
    const videoId = searchParams.get('videoId');
    const episodeIndex = searchParams.get('episodeIndex');

    if (!source || !videoId || episodeIndex === null) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 });
    }

    const downloaded = getDownloader().checkDownloaded(
      source,
      videoId,
      parseInt(episodeIndex, 10)
    );

    return NextResponse.json({ downloaded });
  }

  // 获取所有任务列表
  const taskList = Array.from(tasks.values()).map(serializeTask);

  return NextResponse.json({ tasks: taskList });
}

/**
 * POST - 创建离线下载任务
 */
export async function POST(request: NextRequest) {
  const permission = checkPermission(request);
  if (!permission.ok) {
    return deny(permission);
  }

  try {
    const body = await request.json();
    const { source, videoId, episodeIndex, title, m3u8Url, metadata } = body;

    if (!source || !videoId || episodeIndex === undefined || !title || !m3u8Url) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 });
    }

    const downloader = getDownloader();

    // 1. 首先检查是否已经有相同的任务（任何状态）
    const existingTask = Array.from(tasks.values()).find(
      (t) => t.source === source && t.videoId === videoId && t.episodeIndex === episodeIndex
    );

    if (existingTask) {
      // 如果任务正在下载或等待中，不允许重复创建
      if (existingTask.status === 'downloading' || existingTask.status === 'pending') {
        return NextResponse.json(
          { task: serializeTask(existingTask), message: '该任务正在下载中，请勿重复添加' },
          { status: 400 }
        );
      }

      // 如果任务已完成，不允许重复创建
      if (existingTask.status === 'completed') {
        return NextResponse.json(
          { task: serializeTask(existingTask), message: '该视频已下载完成，如需重新下载请先删除任务' },
          { status: 400 }
        );
      }

      // 如果任务处于错误或暂停状态，提示用户使用重试功能
      if (existingTask.status === 'error' || existingTask.status === 'paused') {
        return NextResponse.json(
          { task: serializeTask(existingTask), message: '该任务已存在但未完成，请使用重试功能继续下载' },
          { status: 400 }
        );
      }
    }

    // 2. 检查文件系统中是否已下载完成（防止任务被删除但文件还在的情况）
    const downloaded = downloader.checkDownloaded(source, videoId, episodeIndex);
    if (downloaded) {
      return NextResponse.json(
        { message: '该视频文件已存在，无需重复下载', downloaded: true },
        { status: 400 }
      );
    }

    // 创建新任务
    const task = await downloader.createTask(source, videoId, episodeIndex, title, m3u8Url, metadata);
    tasks.set(task.id, task);
    saveTasks(); // 持久化任务

    // 开始下载（异步）
    const downloadPromise = downloader
      .startDownload(task, (updatedTask) => {
        // 更新任务状态
        tasks.set(updatedTask.id, updatedTask);
        saveTasks(); // 持久化任务
      })
      .catch((error) => {
        console.error('[OfflineDownload] 下载失败:', error);
        task.status = 'error';
        task.errorMessage = error instanceof Error ? error.message : String(error);
        tasks.set(task.id, task);
        saveTasks(); // 持久化任务
      })
      .finally(() => {
        // 下载完成后，从活跃下载列表中移除
        activeDownloads.delete(task.id);
      });

    activeDownloads.set(task.id, downloadPromise);

    return NextResponse.json({
      task: serializeTask(task),
      message: '任务已创建',
    });
  } catch (error) {
    console.error('[OfflineDownload] 创建任务失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建任务失败' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - 删除任务
 */
export async function DELETE(request: NextRequest) {
  const permission = checkPermission(request);
  if (!permission.ok) {
    return deny(permission);
  }

  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      return NextResponse.json({ error: '缺少任务ID' }, { status: 400 });
    }

    const task = tasks.get(taskId);
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    const downloader = getDownloader();

    // 如果任务正在下载，先标记为取消状态，等待下载停止
    const downloadPromise = activeDownloads.get(taskId);
    if (downloadPromise) {
      // 将任务状态设置为 error，这样下载器会停止下载
      task.status = 'error';
      task.errorMessage = '任务已被删除';
      tasks.set(taskId, task);

      // 从活跃下载列表中移除
      activeDownloads.delete(taskId);

      // 等待一小段时间，让下载操作有机会停止
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // 删除文件
    await downloader.deleteTask(task);

    // 从任务列表中移除
    tasks.delete(taskId);
    saveTasks(); // 持久化任务

    return NextResponse.json({ message: '任务已删除' });
  } catch (error) {
    console.error('[OfflineDownload] 删除任务失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '删除任务失败' },
      { status: 500 }
    );
  }
}

/**
 * PUT - 重试任务（断点续传）
 */
export async function PUT(request: NextRequest) {
  const permission = checkPermission(request);
  if (!permission.ok) {
    return deny(permission);
  }

  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');
    const action = searchParams.get('action');

    if (!taskId) {
      return NextResponse.json({ error: '缺少任务ID' }, { status: 400 });
    }

    if (action !== 'retry') {
      return NextResponse.json({ error: '无效的操作' }, { status: 400 });
    }

    const task = tasks.get(taskId);
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    // 检查任务状态，只有错误、暂停或完成状态可以重试
    if (task.status === 'downloading' || task.status === 'pending') {
      return NextResponse.json({ error: '任务正在进行中，无法重试' }, { status: 400 });
    }

    // 检查是否已经在重试中
    if (activeDownloads.has(taskId)) {
      return NextResponse.json({ error: '任务已在重试中' }, { status: 400 });
    }

    const downloader = getDownloader();

    // 重置任务状态（保留已下载的进度，只重试失败的片段）
    task.status = 'pending';
    // 不重置 progress 和 downloadedSegments，让下载器自动跳过已下载的片段
    task.errorMessage = undefined;
    task.updatedAt = new Date();
    tasks.set(taskId, task);
    saveTasks(); // 持久化任务

    // 开始重新下载（异步）
    const downloadPromise = downloader
      .startDownload(task, (updatedTask) => {
        // 更新任务状态
        tasks.set(updatedTask.id, updatedTask);
        saveTasks(); // 持久化任务
      })
      .catch((error) => {
        console.error('[OfflineDownload] 重试下载失败:', error);
        task.status = 'error';
        task.errorMessage = error instanceof Error ? error.message : String(error);
        tasks.set(task.id, task);
        saveTasks(); // 持久化任务
      })
      .finally(() => {
        // 下载完成后，从活跃下载列表中移除
        activeDownloads.delete(task.id);
      });

    activeDownloads.set(task.id, downloadPromise);

    return NextResponse.json({
      task: serializeTask(task),
      message: '任务已重新开始',
    });
  } catch (error) {
    console.error('[OfflineDownload] 重试任务失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '重试任务失败' },
      { status: 500 }
    );
  }
}
