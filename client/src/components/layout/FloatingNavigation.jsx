import { useEffect, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import { useLocation } from 'react-router-dom';

export function FloatingNavigation() {
  const location = useLocation();
  const [idsInMain, setIdsInMain] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const upClicksRef = useRef({ count: 0, timeoutId: null });
  const downClicksRef = useRef({ count: 0, timeoutId: null });
  const rapidClickWindowMs = 450;

  const navigateToSection = (targetId) => {
    if (!targetId) {
      return;
    }

    const targetSection = document.getElementById(targetId);
    if (!targetSection) {
      return;
    }

    targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    const selector = 'main > section[id]';
    const getSections = () => Array.from(document.querySelectorAll(selector));

    const updateActiveFromMiddle = () => {
      const sections = getSections();
      const ids = sections.map((section) => section.id);
      setIdsInMain(ids);

      if (sections.length === 0) {
        setActiveId(null);
        return;
      }

      const middleY = window.innerHeight / 2;
      const sectionAtMiddle = sections.find((section) => {
        const rect = section.getBoundingClientRect();
        return rect.top <= middleY && rect.bottom >= middleY;
      });
      const currentSection = sectionAtMiddle ?? sections[0];

      setActiveId(currentSection.id);
    };

    updateActiveFromMiddle();
    window.addEventListener('scroll', updateActiveFromMiddle, { passive: true });
    window.addEventListener('resize', updateActiveFromMiddle);
    const main = document.querySelector('main');
    const observer = new MutationObserver(updateActiveFromMiddle);
    if (main) {
      observer.observe(main, { childList: true, subtree: true });
    }

    return () => {
      window.removeEventListener('scroll', updateActiveFromMiddle);
      window.removeEventListener('resize', updateActiveFromMiddle);
      observer.disconnect();
    };
  }, [location.pathname]);

  const activeIndex = idsInMain.indexOf(activeId);
  const upTargetId = activeIndex > 0 ? idsInMain[activeIndex - 1] : idsInMain[0];
  const downTargetId =
    activeIndex >= 0 && activeIndex < idsInMain.length - 1
      ? idsInMain[activeIndex + 1]
      : idsInMain[idsInMain.length - 1];
  const isAtFirstSection = activeIndex <= 0;
  const isAtLastSection = activeIndex >= idsInMain.length - 1;

  if (idsInMain.length === 0) {
    return null;
  }

  const itemClassName =
    'flex min-w-24 items-center justify-center rounded-md border border-(--surface-border) bg-(--surface)/90 px-3 py-2 text-sm font-medium text-(--page-fg) transition hover:bg-(--surface-border)';

  return (
    <nav
      aria-label="Quick section navigation"
      className="fixed left-4 top-1/2 z-40 -translate-y-1/2 p-2"
    >
      <div className="flex flex-col gap-2">
        <a
          href={upTargetId ? `#${upTargetId}` : '#'}
          aria-label="Go one section up"
          className={itemClassName}
          onClick={(event) => {
            event.preventDefault();
            upClicksRef.current.count += 1;
            if (upClicksRef.current.timeoutId) {
              window.clearTimeout(upClicksRef.current.timeoutId);
            }
            upClicksRef.current.timeoutId = window.setTimeout(() => {
              upClicksRef.current.count = 0;
              upClicksRef.current.timeoutId = null;
            }, rapidClickWindowMs);

            if (upClicksRef.current.count >= 2) {
              upClicksRef.current.count = 0;
              window.clearTimeout(upClicksRef.current.timeoutId);
              upClicksRef.current.timeoutId = null;
              window.scrollTo({ top: 0, behavior: 'smooth' });
              return;
            }

            if (isAtFirstSection) {
              window.scrollTo({ top: 0, behavior: 'smooth' });
              return;
            }

            navigateToSection(upTargetId);
          }}
        >
          <Icon icon="material-symbols:keyboard-arrow-up-rounded" className="h-5 w-5" aria-hidden="true" />
        </a>
        {idsInMain.map((id) => (
          <a
            href={`#${id}`}
            className={`${itemClassName} ${activeId === id ? 'border-2! border-amber-300!' : ''}`}
            key={id}
          >
            {id}
          </a>
        ))}
        <a
          href={downTargetId ? `#${downTargetId}` : '#'}
          aria-label="Go one section down"
          className={itemClassName}
          onClick={(event) => {
            event.preventDefault();
            downClicksRef.current.count += 1;
            if (downClicksRef.current.timeoutId) {
              window.clearTimeout(downClicksRef.current.timeoutId);
            }
            downClicksRef.current.timeoutId = window.setTimeout(() => {
              downClicksRef.current.count = 0;
              downClicksRef.current.timeoutId = null;
            }, rapidClickWindowMs);

            if (downClicksRef.current.count >= 2) {
              downClicksRef.current.count = 0;
              window.clearTimeout(downClicksRef.current.timeoutId);
              downClicksRef.current.timeoutId = null;
              window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
              return;
            }

            if (isAtLastSection) {
              window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
              return;
            }

            navigateToSection(downTargetId);
          }}
        >
          <Icon icon="material-symbols:keyboard-arrow-down-rounded" className="h-5 w-5" aria-hidden="true" />
        </a>
      </div>
    </nav>
  );
}