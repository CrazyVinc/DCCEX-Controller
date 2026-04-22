import { useEffect, useState } from 'react';
import { FunctionButtons } from './FunctionButtons.jsx';

export function RollingStockCard({ train, globalSpeedLimit = 127 }) {
  const step = train.Speed && train.Speed.Step != null ? train.Speed.Step : '—';
  const calc = train.Speed && train.Speed.calculated != null ? Number(train.Speed.calculated).toFixed(2) : '—';
  const [speedValue, setSpeedValue] = useState(Math.min(Number(train.Speed.limit ?? 127), globalSpeedLimit));
  const [showSpeedTooltip, setShowSpeedTooltip] = useState(false);
  const speedPercent = globalSpeedLimit === 0 ? 0 : (speedValue / globalSpeedLimit) * 100;

  useEffect(() => {
    setSpeedValue(Math.min(Number(train.Speed.limit ?? 127), globalSpeedLimit));
  }, [train.Speed.limit, globalSpeedLimit]);

  const saveSpeedLimit = async () => {
    await fetch(`/api/trains/${train.DCC_ID}/speed-limit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speedLimit: speedValue }),
    });
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-700/80 bg-slate-900/40 p-5 transition-colors hover:border-amber-300/35">
      <div className="flex flex-1 justify-between">
        <div className="space-y-2">
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

          <div className="mt-4 flex min-h-10 flex-wrap content-start gap-2">
            <FunctionButtons trains={[train]} fixedCab={train.DCC_ID} size="md" layout="horizontal" />
          </div>
        </div>
        <div className="ml-4 flex h-32 w-24 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-slate-700/80">
          <span className="text-[10px] italic text-slate-500">No photo</span>
        </div>
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
              max={globalSpeedLimit}
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
