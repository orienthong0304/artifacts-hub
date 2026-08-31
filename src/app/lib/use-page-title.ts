/**
 * 页面标题 hook：进入页面设置 document.title，离开时恢复默认。
 * 指南索引/详情统一用它处理（默认标题与 index.html 保持一致）。
 */
import { useEffect } from 'react';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@/app/config';

const DEFAULT_TITLE = `${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`;

export function usePageTitle(title?: string) {
  useEffect(() => {
    if (!title) return;
    document.title = title;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
