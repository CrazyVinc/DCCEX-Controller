import { useEffect, useState } from 'react';
import { FunctionButtons } from '../cab/FunctionButtons.jsx';

const TRAIN_SPEED_LIMIT_MAX = 127;

export function RollingStockCard({ train, thumbnailUrl = null, onCardClick, onImageClick }) {
  const step = train.Speed && train.Speed.Step != null ? train.Speed.Step : '—';
  const calc = train.Speed && train.Speed.calculated != null ? Number(train.Speed.calculated).toFixed(2) : '—';
  const [speedValue, setSpeedValue] = useState(Number(train.Speed.limit ?? TRAIN_SPEED_LIMIT_MAX));
  const [showSpeedTooltip, setShowSpeedTooltip] = useState(false);
  const speedPercent = (speedValue / TRAIN_SPEED_LIMIT_MAX) * 100;

  useEffect(() => {
    setSpeedValue(Number(train.Speed.limit ?? TRAIN_SPEED_LIMIT_MAX));
  }, [train.Speed.limit]);

  const saveSpeedLimit = async () => {
    await fetch(`/api/trains/${train.DCC_ID}/speed-limit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speedLimit: speedValue }),
    });
  };

  const handleCardClick = (event) => {
    if (!onCardClick) {
      return;
    }
    const interactiveTarget = event.target.closest('button, input, textarea, select, a, label');
    if (interactiveTarget) {
      return;
    }
    onCardClick(train);
  };

  return (
    <div
      className="flex h-full cursor-pointer flex-col rounded-xl border border-slate-700/80 bg-slate-900/40 p-5 transition-colors hover:border-amber-300/35"
      onClick={handleCardClick}
    >
      <div className="flex flex-1 justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="text-xl font-bold tracking-wide text-amber-300">{train.Name}</h2>
          <div className="space-y-1 text-sm">
            <p>
              <span className="text-slate-400">DCC</span>{' '}
              <span className="font-semibold text-slate-200">{train.DCC_ID}</span>
            </p>
            <p>
              <span className="text-slate-400">Length</span>{' '}
              <span className="font-semibold text-slate-200">{train.Length} mm</span>
            </p>
            <p>
              <span className="text-slate-400">Calibrated speed (step {step})</span>{' '}
              <span className="font-semibold text-slate-200">{calc} mm/s</span>
            </p>
          </div>
        </div>
        <div
          className="flex h-32 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-slate-700/80 bg-slate-900/70"
          onClick={(event) => {
            event.stopPropagation();
            onImageClick?.(train);
          }}
        >
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt={`${train.Name} preview`} className="h-full w-full object-cover" />
          ) : (
            <span className="text-[10px] italic text-slate-500">No photo</span>
          )}
        </div>
      </div>

      <div className="mt-4">
        <FunctionButtons trains={[train]} fixedCab={train.DCC_ID} size="md" layout="horizontal" />
      </div>

      <div className="mt-auto pt-4">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-400">Speed limit</span>
          <div className="relative w-full">
            {showSpeedTooltip ? (
              <span
                className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded bg-slate-800 px-2 py-1 text-xs font-semibold text-amber-300"
                style={{ left: `${speedPercent}%` }}
              >
                {speedValue}
              </span>
            ) : null}
            <input
              type="range"
              min={0}
              max={TRAIN_SPEED_LIMIT_MAX}
              step={1}
              value={speedValue}
              onChange={(event) => setSpeedValue(Number(event.target.value))}
              onMouseDown={() => setShowSpeedTooltip(true)}
              onMouseUp={() => {
                setShowSpeedTooltip(false);
                saveSpeedLimit();
              }}
              onMouseLeave={() => setShowSpeedTooltip(false)}
              onTouchStart={() => setShowSpeedTooltip(true)}
              onTouchEnd={() => {
                setShowSpeedTooltip(false);
                saveSpeedLimit();
              }}
              onFocus={() => setShowSpeedTooltip(true)}
              onBlur={() => {
                setShowSpeedTooltip(false);
                saveSpeedLimit();
              }}
              className="h-2 w-full appearance-none rounded-md bg-slate-700/80 outline-none accent-amber-300"
            />
          </div>
        </div>
  
      </div>
    </div>
  );
}
