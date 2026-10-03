// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/app/play/page.tsx
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.
'use client';

import { ExternalLink } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

interface ExternalPlayerMenuProps {
  /** 当前可播放的视频 URL（由调用方传入，可能是直链或 LunaTV 代理 URL） */
  videoUrl: string;
  /** 视频标题，用于 MX Player 的 intent S.title */
  title?: string;
  className?: string;
}

interface ExternalPlayer {
  name: string;
  icon: string;
  buildSchemeUrl: (videoUrl: string, title: string) => string;
}

/**
 * 外部播放器 URL Scheme 构造（移植自 MoonTVPlus 播放页按钮行）
 * LunaTV 不再经过 /api/proxy-m3u8 重写，直接使用传入的 videoUrl。
 */
const PLAYERS: ExternalPlayer[] = [
  {
    name: 'PotPlayer',
    icon: '/players/potplayer.png',
    buildSchemeUrl: (videoUrl) => `potplayer://${videoUrl}`,
  },
  {
    name: 'VLC',
    icon: '/players/vlc.png',
    buildSchemeUrl: (videoUrl) => `vlc://${videoUrl}`,
  },
  {
    name: 'MPV',
    icon: '/players/mpv.png',
    buildSchemeUrl: (videoUrl) => `mpv://${videoUrl}`,
  },
  {
    name: 'MX Player',
    icon: '/players/mxplayer.png',
    // 注意：不要写死 package=com.mxtech.videoplayer.ad —— 用户侧载版/Pro 版的包名可能不同，
    // 写死后 Chrome 找不到包会直接跳 Play 商店。用通用 VIEW intent 调起系统选择器，
    // 用户从中选择 MX Player 即可（可设为默认）。
    buildSchemeUrl: (videoUrl, title) =>
      `intent:${videoUrl}#Intent;action=android.intent.action.VIEW;type=video/*;S.title=${encodeURIComponent(title)};end`,
  },
  {
    name: 'nPlayer',
    icon: '/players/nplayer.png',
    buildSchemeUrl: (videoUrl) => `nplayer-${videoUrl}`,
  },
  {
    name: 'IINA',
    icon: '/players/iina.png',
    buildSchemeUrl: (videoUrl) => `iina://weblink?url=${encodeURIComponent(videoUrl)}`,
  },
];

/**
 * 外部播放器菜单 — 下拉菜单列出 6 个外部播放器，
 * 点击后通过自定义 URL Scheme 在对应播放器中打开当前视频。
 */
export default function ExternalPlayerMenu({
  videoUrl,
  title = '',
  className = '',
}: ExternalPlayerMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击菜单外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open ]);

  // ESC 键关闭
  useEffect(() => {
    if (!open) return;
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open ]);

  if (!videoUrl) {
    return null;
  }

  const handlePlayerClick = (e: React.MouseEvent, player: ExternalPlayer) => {
    e.stopPropagation();
    // 仅在用户点击时调用 window.open，避免 SSR/水合问题
    window.open(player.buildSchemeUrl(videoUrl, title), '_blank');
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className='flex group relative items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 min-h-[40px] sm:min-h-[44px] rounded-2xl bg-linear-to-br from-white/90 via-white/80 to-white/70 hover:from-white hover:via-white/95 hover:to-white/90 dark:from-gray-800/90 dark:via-gray-800/80 dark:to-gray-800/70 dark:hover:from-gray-800 dark:hover:via-gray-800/95 dark:hover:to-gray-800/90 backdrop-blur-md border border-white/60 dark:border-gray-700/60 shadow-[0_2px_8px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.25)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.3)] dark:hover:shadow-[0_4px_12px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.15)] hover:scale-105 active:scale-95 transition-all duration-300 overflow-hidden'
        title='用外部播放器打开'
        aria-expanded={open}
      >
        <div className='absolute inset-0 bg-linear-to-r from-transparent via-white/0 to-transparent group-hover:via-white/30 dark:group-hover:via-white/10 transition-all duration-500'></div>
        <ExternalLink className='relative z-10 w-3.5 sm:w-4 h-3.5 sm:h-4 text-gray-600 dark:text-gray-400' />
        <span className='relative z-10 hidden sm:inline text-xs font-medium text-gray-600 dark:text-gray-300'>
          外部播放器
        </span>
      </button>

      {open && (
        <div className='absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg'>
          <div className='px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700'>
            选择外部播放器
          </div>
          <div className='py-1'>
            {PLAYERS.map((player) => (
              <button
                key={player.name}
                onClick={(e) => handlePlayerClick(e, player)}
                className='flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer'
                title={`用 ${player.name} 打开`}
              >
                <Image src={player.icon} alt={player.name} width={20} height={20} className='flex-shrink-0' />
                <span>{player.name}</span>
              </button>
            ))}
          </div>
          <div className='px-3 py-2 text-[11px] leading-4 text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700'>
            需在设备上安装对应播放器，点击后将跳转到该应用
          </div>
        </div>
      )}
    </div>
  );
}
