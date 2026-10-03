// Ported from mtvpls/MoonTVPlus (MIT License) — 服务器离线下载面板宿主
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.
'use client';

import { useCallback, useEffect, useState } from 'react';

import nextDynamic from 'next/dynamic';

const OfflineDownloadPanel = nextDynamic(
  () => import('./OfflineDownloadPanel').then((m) => m.OfflineDownloadPanel),
  { ssr: false }
);

/** 打开服务器离线下载面板的全局事件名 */
export const OFFLINE_DOWNLOAD_PANEL_EVENT = 'open-offline-download-panel';

/** 在任意客户端组件中调用以打开离线下载面板 */
export function openOfflineDownloadPanel() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OFFLINE_DOWNLOAD_PANEL_EVENT));
  }
}

/**
 * 挂载在全局 layout 中的宿主：监听打开事件并渲染 OfflineDownloadPanel。
 * 仅在 NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD=true 时渲染。
 */
export function OfflineDownloadPanelHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OFFLINE_DOWNLOAD_PANEL_EVENT, handler);
    return () => window.removeEventListener(OFFLINE_DOWNLOAD_PANEL_EVENT, handler);
  }, []);

  const handleClose = useCallback(() => setOpen(false), []);

  if (process.env.NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD !== 'true') {
    return null;
  }

  return <OfflineDownloadPanel isOpen={open} onClose={handleClose} />;
}
