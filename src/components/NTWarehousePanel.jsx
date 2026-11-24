'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Maximize2, Minimize2 } from 'lucide-react';
import styles from './NTWarehousePanel.module.css';

export default function NTWarehousePanel({ staging = false }) {
  const [expanded, setExpanded] = useState(false);
  const [scrollWidth, setScrollWidth] = useState(1440);
  const [hasOverflow, setHasOverflow] = useState(false);
  const viewportRef = useRef(null);
  const topScrollRef = useRef(null);
  const expandButtonRef = useRef(null);
  const src = staging ? 'https://fix.nextrade-staging.com/admin' : 'https://nextradeindustries.com/admin';
  const title = staging ? 'NT Warehouse Staging' : 'NT Warehouse';

  useEffect(() => {
    const viewport = viewportRef.current;
    const measure = () => {
      setScrollWidth(viewport.scrollWidth);
      setHasOverflow(viewport.scrollWidth > viewport.clientWidth + 1);
      if (topScrollRef.current) topScrollRef.current.scrollLeft = viewport.scrollLeft;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setExpanded(false);
        expandButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  // Scroll the outer viewport, never inspect the cross-origin warehouse document.
  const syncScroll = (event, targetRef) => {
    const target = targetRef.current;
    if (target && Math.abs(target.scrollLeft - event.currentTarget.scrollLeft) > 1) {
      target.scrollLeft = event.currentTarget.scrollLeft;
    }
  };

  return (
    <section aria-label={title} className={`${styles.panel} ${expanded ? styles.expanded : ''} ${staging ? styles.staging : ''}`}>
      <div className={styles.toolbar}>
        <strong className={styles.title}>NT Warehouse</strong>
        <span className={staging ? styles.testBadge : styles.liveBadge}>{staging ? 'STAGING / TEST' : 'LIVE'}</span>
        <div className={styles.actions}>
          <button type="button" ref={expandButtonRef} aria-pressed={expanded}
            aria-label={expanded ? 'Restore warehouse view' : 'Expand warehouse view'}
            title={expanded ? 'Restore warehouse view' : 'Expand warehouse view'}
            onClick={() => setExpanded(value => !value)}>
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <a href={src} target="_blank" rel="noopener noreferrer" aria-label="Open warehouse in its own window"
            title="Open warehouse in its own window"><ExternalLink size={16} /></a>
        </div>
      </div>
      <div ref={topScrollRef} className={styles.topScroll} hidden={!hasOverflow}
        role="region" tabIndex={hasOverflow ? 0 : -1} aria-label="Warehouse horizontal scroll, top"
        onScroll={event => syncScroll(event, viewportRef)}>
        <div style={{ width: scrollWidth, height: 1 }} />
      </div>
      <div ref={viewportRef} className={styles.viewport} role="region" tabIndex={0}
        aria-label="Warehouse horizontal scroll, bottom" onScroll={event => syncScroll(event, topScrollRef)}>
        <iframe src={src} title={title} className={styles.frame} />
      </div>
    </section>
  );
}
