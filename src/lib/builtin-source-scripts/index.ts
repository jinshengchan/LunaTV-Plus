// 内置视频源脚本：随仓库版本管理，服务端启动后自动播种到脚本注册表。
// 已存在的同 key 脚本不会被覆盖（用户在管理后台的修改优先）。
// Ported for LunaTV-Plus (CC BY-NC-SA 4.0).

import { SOURCE_SCRIPT_18J_CODE } from './18j';

export interface BuiltinSourceScript {
  key: string;
  name: string;
  description: string;
  code: string;
}

export const BUILTIN_SOURCE_SCRIPTS: BuiltinSourceScript[] = [
  {
    key: 'j18',
    name: '18J',
    description: '18j.tv 全站采集（站内搜索索引 + 播放页解析 m3u8）',
    code: SOURCE_SCRIPT_18J_CODE,
  },
];
