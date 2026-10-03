// Ported from mtvpls/MoonTVPlus (MIT License) — 小雅私人影库管理配置卡片
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.
'use client';

import { Cloud } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';

interface XiaoyaConfigProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

const XiaoyaConfig: React.FC<XiaoyaConfigProps> = ({ config, refreshConfig }) => {
  const [enabled, setEnabled] = useState(false);
  const [serverURL, setServerURL] = useState('');
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [disableVideoPreview, setDisableVideoPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const c = config?.XiaoyaConfig;
    if (c) {
      setEnabled(c.Enabled ?? false);
      setServerURL(c.ServerURL || '');
      setToken(c.Token || '');
      setUsername(c.Username || '');
      setPassword(c.Password || '');
      setDisableVideoPreview(c.DisableVideoPreview ?? false);
    }
  }, [config]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const payload = () => ({
    Enabled: enabled,
    ServerURL: serverURL,
    Token: token,
    Username: username,
    Password: password,
    DisableVideoPreview: disableVideoPreview,
  });

  const handleTest = async () => {
    setIsTesting(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/xiaoya', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', ...payload() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || data.message || '连接失败');
      showMessage('success', '连接成功');
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
      const res = await fetch('/api/admin/xiaoya', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', ...payload() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '保存失败');
      showMessage('success', '小雅配置保存成功！');
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
          <Cloud className='text-blue-600 dark:text-blue-400 shrink-0 mt-1' size={20} />
          <div>
            <h3 className='text-sm font-semibold text-gray-900 dark:text-white mb-2'>
              小雅私人影库（移植自 MoonTVPlus）
            </h3>
            <ul className='text-sm text-gray-600 dark:text-gray-400 space-y-1'>
              <li>• 接入小雅 Alist 影库，浏览/搜索/播放网盘资源</li>
              <li>• 推荐使用 Token 认证，也支持账号密码</li>
            </ul>
          </div>
        </div>
      </div>

      <div className='flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg'>
        <div>
          <h3 className='text-lg font-semibold text-gray-900 dark:text-white'>启用小雅</h3>
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
          <label className={labelCls}>Alist 服务器地址</label>
          <input className={inputCls} value={serverURL} onChange={(e) => setServerURL(e.target.value)} placeholder='http://192.168.1.10:5678' />
        </div>
        <div className='md:col-span-2'>
          <label className={labelCls}>Token（推荐）</label>
          <input className={inputCls} value={token} onChange={(e) => setToken(e.target.value)} placeholder='Alist Token，留空则不修改' />
        </div>
        <div>
          <label className={labelCls}>账号（备选）</label>
          <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} placeholder='admin' />
        </div>
        <div>
          <label className={labelCls}>密码（备选）</label>
          <input type='password' className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} placeholder='留空则不修改' />
        </div>
        <div className='flex items-center gap-3'>
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

export default XiaoyaConfig;
