const BTN =
  'inline-flex cursor-pointer items-center overflow-hidden rounded-md border border-slate-700 bg-slate-800 text-sm shadow-sm transition-colors hover:border-slate-500';
const ACTIVE = ['!border-2', '!border-amber-300'];

export function TrainPicker({ trains, selectedCab, onSelect }) {
  return (
    <div className="train-controller-buttons flex flex-row flex-wrap gap-2">
      {trains.map((train) => {
        const id = String(train.DCC_ID);
        const isOn = String(selectedCab) === id;
        return (
          <button
            key={id}
            type="button"
            className={`${BTN} ${isOn ? ACTIVE.join(' ') : ''}`}
            onClick={() => onSelect(train.DCC_ID)}
          >
            <span className="px-4 py-2 font-semibold text-slate-100">{train.Name}</span>
            <span className="border-l border-slate-600 bg-slate-900/90 px-3 py-2 font-medium text-slate-300">
              {train.DCC_ID}
            </span>
          </button>
        );
      })}
    </div>
  );
}
