export function Hr({ text }) {
  return (
    <div className="flex items-center gap-3 py-0.5" role="presentation">
      <div className="h-px flex-1 bg-slate-600/80" />
      <span className="shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-amber-300/70">{text}</span>
      <div className="h-px flex-1 bg-slate-600/80" />
    </div>
  );
}
