import {useEffect, useState} from 'react';
import type {ProductSection} from './product_types.js';

const STORAGE_KEY = 'struinfo:workspace-on-reload:v1';
const WORKSPACES = [
  'overview',
  'import',
  'documents',
  'query',
  'reports',
  'settings',
] as const;

function sectionOnLoad(): ProductSection {
  try {
    const navigation = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    if (navigation?.type !== 'reload') return 'overview';
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return WORKSPACES.find((section) => section === saved) ?? 'overview';
  } catch {
    return 'overview';
  }
}

/** Remember only the workspace on refresh; new visits still begin at overview. */
export function useReloadNavigation() {
  const [section, setSection] = useState<ProductSection>(sectionOnLoad);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, section);
    } catch {
      /* Navigation remains usable when browser storage is unavailable. */
    }
  }, [section]);
  return [section, setSection] as const;
}
