'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface ScriptItem {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
}

export default function SourceScriptsPage() {
  const [items, setItems] = useState<ScriptItem[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [key, setKey] = useState('j18');
  const [name, setName] = useState('18J');
  const [code, setCode] = useState('');
  const [fileText, setFileText] = useState('');
  const [fileName, setFileName] = useState('');

  const reload = useCallback(async () => {
    const response = await fetch('/api/admin/source-script', {
      cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? '请先登录管理员账号，再打开此页面。'
          : data.error || '加载失败',
      );
    setItems(data.items || []);
    setReady(true);
  }, []);

  useEffect(() => {
    void reload().catch((error) => setMessage(error.message));
  }, [reload]);

  const submit = async (useFile: boolean) => {
    setBusy(true);
    setMessage('');
    try {
      let entries;
      if (useFile) {
        const parsed = JSON.parse(fileText);
        entries = Array.isArray(parsed) ? parsed : parsed.items;
        if (!Array.isArray(entries) || !entries.length)
          throw new Error('配置文件需要包含非空 items 列表。');
        if (
          entries.some(
            (item) =>
              !item.key ||
              !item.name ||
              typeof item.code !== 'string' ||
              !item.code.trim(),
          )
        ) {
          throw new Error('每个脚本都需要 key、name 和 code。');
        }
      } else {
        if (!key.trim() || !name.trim() || !code.trim())
          throw new Error('请填写源标识、名称和脚本。');
        entries = [{ key: key.trim(), name: name.trim(), code, enabled: true }];
      }
      const response = await fetch('/api/admin/source-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import', items: entries }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new Error(result.error || '导入失败');
      setMessage('导入成功。已启用的脚本源会参与网站搜索。');
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  const field =
    'w-full rounded-lg border border-gray-300 bg-transparent p-3 dark:border-gray-600';
  return (
    <main className='mx-auto max-w-2xl space-y-6 px-4 py-8 text-gray-900 dark:text-gray-100'>
      <Link href='/admin' className='text-green-600'>
        ← 返回管理后台
      </Link>
      <h1 className='text-2xl font-bold'>脚本视频源</h1>
      <p>
        选择 JSON 配置文件，或粘贴以 return
        开头的脚本。相同源标识会更新已有配置。
      </p>
      <p className='text-sm text-gray-500'>
        脚本在服务器执行，请只导入可信脚本。导入成功后仍需验证搜索和播放。
      </p>
      {message && (
        <p
          role='status'
          className='break-words rounded-lg bg-gray-100 p-3 dark:bg-gray-800'
        >
          {message}
        </p>
      )}
      {ready && (
        <>
          <section className='space-y-3 rounded-xl border p-4'>
            <h2 className='font-semibold'>从文件导入</h2>
            <input
              aria-label='选择脚本源配置文件'
              type='file'
              accept='.json,application/json'
              disabled={busy}
              className='block w-full text-sm'
              onChange={async (event) => {
                const file = event.target.files?.[0];
                setFileText('');
                setFileName('');
                if (!file) return;
                try {
                  setFileText(await file.text());
                  setFileName(file.name);
                } catch {
                  setMessage('无法读取文件，请重新选择。');
                }
              }}
            />
            {fileName && <p className='break-all text-sm'>{fileName}</p>}
            <button
              className='rounded-lg bg-green-600 px-4 py-3 text-white disabled:opacity-50'
              disabled={busy || !fileText}
              onClick={() => void submit(true)}
            >
              导入配置文件
            </button>
          </section>
          <section className='space-y-3 rounded-xl border p-4'>
            <h2 className='font-semibold'>粘贴脚本导入</h2>
            <label className='block'>
              源标识
              <input
                className={field}
                value={key}
                disabled={busy}
                onChange={(event) => setKey(event.target.value)}
              />
            </label>
            <label className='block'>
              名称
              <input
                className={field}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className='block'>
              脚本
              <textarea
                className={field + ' min-h-64 font-mono text-sm'}
                value={code}
                disabled={busy}
                placeholder='return { meta: ..., async search(...) ... };'
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <button
              className='rounded-lg bg-green-600 px-4 py-3 text-white disabled:opacity-50'
              disabled={busy || !code.trim()}
              onClick={() => void submit(false)}
            >
              {busy ? '正在导入…' : '保存并启用'}
            </button>
          </section>
          <section className='space-y-3'>
            <h2 className='font-semibold'>已导入的脚本</h2>
            {items.length === 0 ? (
              <p>暂无脚本源。</p>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className='flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3'
                >
                  <span className='break-all'>
                    {item.name}（{item.key}）
                  </span>
                  <span>{item.enabled ? '已启用' : '已停用'}</span>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </main>
  );
}
