import {useEffect, useState} from 'react';

/** Presentation only: no task authorization or document state is stored here. */
export function useRememberedDisclosure(name: string) {
  const key = 'struinfo:disclosure:v1:' + name;
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(key) === 'true';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, String(expanded));
    } catch {
      /* Browser storage is optional; toggling still works without it. */
    }
  }, [key, expanded]);
  return [expanded, setExpanded] as const;
}
