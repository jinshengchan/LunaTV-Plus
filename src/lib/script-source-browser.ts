import {
  executeSavedSourceScript,
  listEnabledSourceScripts,
  normalizeScriptSources,
} from '@/lib/source-script';

export async function getScriptBrowserSource(source: string) {
  if (!source.startsWith('script:')) return null;
  const key = source.slice('script:'.length);
  return (
    (await listEnabledSourceScripts()).find((item) => item.key === key) || null
  );
}

export async function getScriptBrowserCategories(key: string) {
  const execution = await executeSavedSourceScript({
    key,
    hook: 'getSources',
    payload: {},
  });
  return normalizeScriptSources(execution.result).map((source) => ({
    type_id: source.id,
    type_name: source.name,
  }));
}

export async function getScriptBrowserList(
  key: string,
  typeId: string | null,
  page: number,
  keyword = '',
) {
  const categories = await getScriptBrowserCategories(key);
  const selected = typeId
    ? categories.find((item) => item.type_id === typeId)
    : categories[0];
  if (!selected) throw new Error('脚本分类不存在');
  const execution = await executeSavedSourceScript({
    key,
    hook: 'search',
    payload: { keyword, page, sourceId: selected.type_id },
  });
  const result = execution.result || {};
  const items = (Array.isArray(result.list) ? result.list : [])
    .map((item) => ({
      id: String(item.id || ''),
      title: String(item.title || ''),
      poster: String(item.poster || ''),
      year: String(item.year || ''),
      type_name: String(item.type_name || ''),
      remarks: String(item.vod_remarks || ''),
      source: `script:${key}:${selected.type_id}`,
    }))
    .filter((item) => item.id && item.title);
  const pageCount = Number(result.pageCount ?? result.pagecount ?? 1);
  return {
    items,
    meta: {
      page,
      pagecount: Number.isFinite(pageCount) ? Math.max(page, pageCount) : page,
      total: Number(result.total ?? items.length),
      limit: items.length,
    },
  };
}
