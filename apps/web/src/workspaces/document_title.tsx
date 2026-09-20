import {useEffect, useRef, useState} from 'react';
import {FloatingToolPanel} from '../components/floating_tool_panel.js';
import {compactDocumentTitle} from '../components/reading_text.js';

export function DocumentTitle({title}: {readonly title: string}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [clipped, setClipped] = useState(false);
  const compact = compactDocumentTitle(title);
  useEffect(() => {
    const element = heading.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => {
      setClipped(element.scrollHeight > element.clientHeight + 1);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [title]);
  return (
    <div className="document-title">
      <h2 ref={heading}>{compact}</h2>
      {compact !== title || clipped ? (
        <FloatingToolPanel
          title="完整标题"
          className="document-title__disclosure"
        >
          <p className="document-title__full">{title}</p>
        </FloatingToolPanel>
      ) : null}
    </div>
  );
}
