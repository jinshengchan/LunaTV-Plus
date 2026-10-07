'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import PageLayout from '@/components/PageLayout';

interface DiskFile {
  id: string;
  name: string;
  directory: boolean;
  video: boolean;
  size: number;
}

function NetDiskPlayer() {
  const sessionId = useSearchParams().get('session') || '';
  const [title, setTitle] = useState('网盘播放');
  const [files, setFiles] = useState<DiskFile[]>([]);
  const [path, setPath] = useState([{ id: '0', name: '分享目录' }]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState<{
    id: string;
    name: string;
    url: string;
  } | null>(null);
  const requestId = useRef(0);
  const selectVideo = useCallback(
    async (file: DiskFile) => {
      const sequence = ++requestId.current;
      setBusy(true);
      setError('');
      try {
        const response = await fetch('/api/netdisk/play', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, fileId: file.id }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '准备播放失败');
        if (sequence === requestId.current)
          setPlaying({ id: file.id, name: data.name, url: data.url });
      } catch (error) {
        if (sequence === requestId.current)
          setError(error instanceof Error ? error.message : '准备播放失败');
      } finally {
        if (sequence === requestId.current) setBusy(false);
      }
    },
    [sessionId],
  );

  const loadFolder = useCallback(
    async (nextPath: typeof path, nextPage = 1, autoPlay = false) => {
      const sequence = ++requestId.current;
      setBusy(true);
      setError('');
      try {
        if (!sessionId) throw new Error('请从网盘搜索结果选择在线播放');
        const response = await fetch('/api/netdisk/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            folderId: nextPath[nextPath.length - 1].id,
            page: nextPage,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '读取分享目录失败');
        if (sequence !== requestId.current) return;
        setTitle(data.title);
        setFiles(data.files);
        setPath(nextPath);
        setPage(nextPage);
        setHasMore(data.hasMore);
        const videos = data.files.filter((file: DiskFile) => file.video);
        if (
          autoPlay &&
          videos.length === 1 &&
          !data.hasMore &&
          !data.files.some((file: DiskFile) => file.directory)
        ) {
          await selectVideo(videos[0]);
        }
      } catch (error) {
        if (sequence === requestId.current)
          setError(error instanceof Error ? error.message : '读取分享目录失败');
      } finally {
        if (sequence === requestId.current) setBusy(false);
      }
    },
    [sessionId, selectVideo],
  );

  useEffect(() => {
    const sequence = requestId;
    setPlaying(null);
    void loadFolder([{ id: '0', name: '分享目录' }], 1, true);
    return () => {
      sequence.current++;
    };
  }, [loadFolder]);

  const playNext = () => {
    if (busy) return;
    const videos = files.filter((file) => file.video);
    const index = videos.findIndex((file) => file.id === playing?.id);
    if (index >= 0 && index + 1 < videos.length)
      void selectVideo(videos[index + 1]);
  };

  return (
    <PageLayout activePath='/search'>
      <div className='mx-auto max-w-6xl space-y-5 p-4 sm:p-6'>
        <h1 className='text-xl font-semibold'>{title}</h1>
        {playing ? (
          <div className='space-y-2'>
            <video
              key={playing.url}
              src={playing.url}
              controls
              autoPlay
              playsInline
              className='aspect-video w-full rounded-xl bg-black'
              onEnded={playNext}
              onError={() =>
                setError(
                  '视频无法播放：请重新选择视频；若其他文件正常，请检查该文件的编码是否受浏览器支持。',
                )
              }
            />
            <p className='break-all text-sm'>{playing.name}</p>
            <button
              disabled={busy}
              onClick={playNext}
              className='rounded-lg bg-green-600 px-4 py-2 text-sm text-white disabled:opacity-50'
            >
              下一集
            </button>
          </div>
        ) : (
          <div className='flex aspect-video items-center justify-center rounded-xl bg-black text-sm text-gray-300'>
            选择下方的视频文件开始播放
          </div>
        )}
        {busy && (
          <p role='status' className='text-sm text-green-600'>
            正在读取资源或准备播放，请稍候…
          </p>
        )}
        {error && (
          <p
            role='alert'
            className='rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300'
          >
            {error}
          </p>
        )}
        <nav aria-label='分享目录' className='flex flex-wrap gap-2'>
          {path.map((folder, index) => (
            <button
              key={folder.id}
              disabled={busy}
              className='rounded-lg border px-3 py-2 text-sm disabled:opacity-50'
              onClick={() => loadFolder(path.slice(0, index + 1))}
            >
              {folder.name}
            </button>
          ))}
        </nav>
        <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
          {files.map((file) => (
            <button
              key={file.id}
              disabled={busy}
              className={`rounded-lg border p-3 text-left text-sm hover:border-green-500 disabled:opacity-50 ${playing?.id === file.id ? 'border-green-500 text-green-600' : ''}`}
              onClick={() =>
                file.directory
                  ? loadFolder([...path, { id: file.id, name: file.name }])
                  : selectVideo(file)
              }
            >
              <span className='break-all'>
                {file.directory ? '📁 ' : '▶ '}
                {file.name}
              </span>
            </button>
          ))}
        </div>
        {!busy && files.length === 0 && (
          <p className='text-sm text-gray-500'>此页未发现视频文件或子目录。</p>
        )}
        <div className='flex items-center gap-3'>
          <button
            disabled={busy || page <= 1}
            onClick={() => loadFolder(path, page - 1)}
            className='rounded-lg border px-3 py-2 text-sm disabled:opacity-50'
          >
            上一页
          </button>
          <span className='text-sm'>第 {page} 页</span>
          <button
            disabled={busy || !hasMore}
            onClick={() => loadFolder(path, page + 1)}
            className='rounded-lg border px-3 py-2 text-sm disabled:opacity-50'
          >
            下一页
          </button>
        </div>
      </div>
    </PageLayout>
  );
}

export default function NetDiskPlayPage() {
  return (
    <Suspense fallback={<div className='p-6'>正在加载网盘播放器…</div>}>
      <NetDiskPlayer />
    </Suspense>
  );
}
