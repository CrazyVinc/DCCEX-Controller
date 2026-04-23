import { useEffect, useState } from 'react';

export function Section({
  id,
  title,
  className = '',
  headerAction = null,
  children,
  collapsibleBelowLg = false,
  defaultOpenBelowLg = true,
  titleClassName = 'text-amber-300',
}) {
  const safeId =
    id ??
    (title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') ||
      'section');

  const [openBelowLg, setOpenBelowLg] = useState(defaultOpenBelowLg);

  useEffect(() => {
    if (!collapsibleBelowLg) {
      return;
    }
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => {
      if (mq.matches) {
        setOpenBelowLg(true);
      }
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [collapsibleBelowLg]);

  const bodyClass = collapsibleBelowLg
    ? openBelowLg
      ? ''
      : 'max-lg:hidden lg:block'
    : '';

  return (
    <section
      id={safeId}
      className={`rounded-2xl border border-slate-700/80 bg-[#121a2f] p-4 shadow-[0_0_24px_rgba(56,189,248,0.1)] ${className}`.trim()}
    >
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-slate-700/80 pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {collapsibleBelowLg ? (
            <button
              type="button"
              className="-m-1 shrink-0 p-1 text-slate-400 hover:text-slate-200 lg:hidden"
              aria-expanded={openBelowLg}
              aria-controls={`${safeId}-body`}
              onClick={() => setOpenBelowLg((v) => !v)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className={`h-5 w-5 transition-transform duration-150 ${openBelowLg ? '' : '-rotate-90'}`}
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          ) : null}
          <a href={`#${safeId}`} className="block min-w-0 flex-1">
            <span className={`text-sm font-semibold uppercase tracking-wider ${titleClassName}`}>{title}</span>
          </a>
        </div>
        {headerAction}
      </div>
      <div id={`${safeId}-body`} className={bodyClass || undefined}>
        {children}
      </div>
    </section>
  );
}
