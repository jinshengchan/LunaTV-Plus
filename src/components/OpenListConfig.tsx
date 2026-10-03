// Ported from mtvpls/MoonTVPlus (MIT License) — OpenList 私人影库管理配置卡片
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.
'use client';

import { HardDrive } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';

interface OpenListConfigProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

const OpenListConfig: React.FC<OpenListConfigProps> = ({ config, refreshConfig }) => {
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rootPaths, setRootPaths] = useState('/'); // 换行分隔
  const [offlineDownloadPath, setOfflineDownloadPath] = useState('/');
  const [offlineDownloadUseCustomSource, setOfflineDownloadUseCustomSource] = useState(false);
  const [offlineDownloadUrl, setOfflineDownloadUrl] = useState('');
  const [offlineDownloadUsername, setOfflineDownloadUsername] = useState('');
  const [offlineDownloadPassword, setOfflineDownloadPassword] = useState('');
  const [disableVideoPreview, setDisableVideoPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const c = config?.openlist;
    if (c) {
      setEnabled(c.enabled ?? false);
      setUrl(c.url || '');
      setUsername(c.username || '');
      setPassword(c.password || '');
      setRootPaths((c.rootPaths || ['/']).join('\n'));
      setOfflineDownloadPath(c.offlineDownloadPath || '/');
      setOfflineDownloadUseCustomSource(c.offlineDownloadUseCustomSource ?? false);
      setOfflineDownloadUrl(c.offlineDownloadUrl || '');
      setOfflineDownloadUsername(c.offlineDownloadUsername || '');
      setOfflineDownloadPassword(c.offlineDownloadPassword || '');
      setDisableVideoPreview(c.disableVideoPreview ?? false);
    }
  }, [config]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleTest = async () => {
    setIsTesting(true);
    setMessage(null);
    try {
      const res = await fetch('/api/openlist/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || data.message || '连接失败');
      showMessage('success', '连接成功：' + (data.message || ''));
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : '连接失败');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/openlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          enabled,
          url,
          username,
          password,
          rootPaths: rootPaths.split('\n').map((s) => s.trim()).filter(Boolean),
          offlineDownloadPath,
          offlineDownloadUseCustomSource,
          offlineDownloadUrl,
          offlineDownloadUsername,
          offlineDownloadPassword,
          disableVideoPreview,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存失败');
      showMessage('success', 'OpenList 配置保存成功！');
      await refreshConfig();
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

  return (
    <div className='space-y-6'>
      {message && (
        <div
          className={`p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className='p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800'>
        <div className='flex items-start gap-3'>
          <HardDrive className='text-blue-600 dark:text-blue-400 shrink-0 mt-1' size={20} />
          <div>
            <h3 className='text-sm font-semibold text-gray-900 dark:text-white mb-2'>
              OpenList 私人影库（移植自 MoonTVPlus）
            </h3>
            <ul className='text-sm text-gray-600 dark:text-gray-400 space-y-1'>
              <li>• 接入自建 OpenList/Alist，浏览网盘/本地影库资源</li>
              <li>• 磁力搜索结果可一键推送至 OpenList 离线下载（aria2/qBittorrent/Transmission）</li>
              <li>• 保存时会自动验证账号密码</li>
            </ul>
          </div>
        </div>
      </div>

      <div className='flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg'>
        <div>
          <h3 className='text-lg font-semibold text-gray-900 dark:text-white'>启用 OpenList</h3>
          <p className='text-sm text-gray-600 dark:text-gray-400 mt-1'>开启后相关接口可用</p>
        </div>
        <button
          onClick={() => setEnabled(!enabled)}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
            enabled ? 'bg-green-600' : 'bg-gray-200 dark:bg-gray-700'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
        <div className='md:col-span-2'>
          <label className={labelCls}>OpenList 服务地址</label>
          <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder='http://192.168.1.10:5244' />
        </div>
        <div>
          <label className={labelCls}>账号</label>
          <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} placeholder='admin' />
        </div>
        <div>
          <label className={labelCls}>密码</label>
          <input type='password' className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} placeholder='留空则不修改' />
        </div>
        <div className='md:col-span-2'>
          <label className={labelCls}>影库根目录（每行一个）</label>
          <textarea className={inputCls} rows={2} value={rootPaths} onChange={(e) => setRootPaths(e.target.value)} placeholder='/' />
        </div>
        <div>
          <label className={labelCls}>离线下载目标目录</label>
          <input className={inputCls} value={offlineDownloadPath} onChange={(e) => setOfflineDownloadPath(e.target.value)} placeholder='/' />
        </div>
        <div className='flex items-center gap-3 pt-6'>
          <button
            onClick={() => setDisableVideoPreview(!disableVideoPreview)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              disableVideoPreview ? 'bg-green-600' : 'bg-gray-200 dark:bg-gray-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                disableVideoPreview ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span className='text-sm text-gray-700 dark:text-gray-300'>禁用视频预览流（改用直连）</span>
        </div>
      </div>

      <div className='p-4 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-4'>
        <div className='flex items-center gap-3'>
          <button
            onClick={() => setOfflineDownloadUseCustomSource(!offlineDownloadUseCustomSource)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              offlineDownloadUseCustomSource ? 'bg-green-600' : 'bg-gray-200 dark:bg-gray-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                offlineDownloadUseCustomSource ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span className='text-sm font-medium text-gray-700 dark:text-gray-300'>离线下载使用独立的 OpenList</span>
        </div>
        {offlineDownloadUseCustomSource && (
          <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
            <input className={inputCls} value={offlineDownloadUrl} onChange={(e) => setOfflineDownloadUrl(e.target.value)} placeholder='离线下载 OpenList 地址' />
            <input className={inputCls} value={offlineDownloadUsername} onChange={(e) => setOfflineDownloadUsername(e.target.value)} placeholder='账号' />
            <input type='password' className={inputCls} value={offlineDownloadPassword} onChange={(e) => setOfflineDownloadPassword(e.target.value)} placeholder='密码' />
          </div>
        )}
      </div>

      <div className='flex justify-end gap-3'>
        <button
          onClick={handleTest}
          disabled={isTesting}
          className='px-6 py-2 rounded-lg font-medium transition-colors bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 disabled:opacity-50'
        >
          {isTesting ? '测试中...' : '测试连接'}
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            isSaving ? 'bg-gray-400 cursor-not-allowed text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {isSaving ? '保存中...' : '保存配置'}
        </button>
      </div>
    </div>
  );
};

export default OpenListConfig;
