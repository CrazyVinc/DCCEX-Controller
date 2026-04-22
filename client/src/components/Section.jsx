export function Section({ id, title, className = '', headerAction = null, children }) {
  const safeId =
    id ??
    (title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') ||
      'section');

  return (
    <section
      id={safeId}
      className={`rounded-2xl border border-slate-700/80 bg-[#121a2f] p-4 shadow-[0_0_24px_rgba(56,189,248,0.1)] ${className}`.trim()}
    >
      <div className="mb-3 flex items-center justify-between border-b border-slate-700/80 pb-2">
        <a href={`#${safeId}`} className="block flex-1">
          <span className="text-sm font-semibold uppercase tracking-wider text-amber-300">{title}</span>
        </a>
        {headerAction}
      </div>
      {children}
    </section>
  );
}
