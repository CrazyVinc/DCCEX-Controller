export function WagonCard({ wagon, thumbnailUrl = null, onCardClick, onImageClick }) {
  const handleCardClick = (event) => {
    if (!onCardClick) {
      return;
    }
    const interactiveTarget = event.target.closest('button, input, textarea, select, a, label');
    if (interactiveTarget) {
      return;
    }
    onCardClick(wagon);
  };

  return (
    <div
      className="flex h-full cursor-pointer flex-col rounded-xl border border-slate-700/80 bg-slate-900/40 p-5 transition-colors hover:border-sky-400/35"
      onClick={handleCardClick}
    >
      <div className="flex flex-1 justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="text-xl font-bold tracking-wide text-sky-200">{wagon.Name}</h2>
          <div className="space-y-1 text-sm">
            <p>
              <span className="text-slate-400">Length</span>{' '}
              <span className="font-semibold text-slate-200">{wagon.Length} mm</span>
            </p>
          </div>
        </div>
        <div
          className="flex h-32 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-slate-700/80 bg-slate-900/70"
          onClick={(event) => {
            event.stopPropagation();
            onImageClick?.(wagon);
          }}
        >
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt={`${wagon.Name} preview`} className="h-full w-full object-cover" />
          ) : (
            <span className="text-[10px] italic text-slate-500">No photo</span>
          )}
        </div>
      </div>
    </div>
  );
}
