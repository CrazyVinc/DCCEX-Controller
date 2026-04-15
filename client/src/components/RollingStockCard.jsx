import { FunctionButtons } from './FunctionButtons.jsx';

export function RollingStockCard({ train }) {
  const step = train.Speed && train.Speed.Step != null ? train.Speed.Step : '—';
  const calc =
    train.Speed && train.Speed.calculated != null
      ? Number(train.Speed.calculated).toFixed(2)
      : '—';

  return (
    <div className="flex justify-between rounded-xl border border-[#30363d] bg-[#1c2128] p-5 hover:border-[#ff9d004d]">
      <div className="space-y-2">
        <h2 className="text-xl font-bold tracking-wide text-[#ff9d00]">{train.Name}</h2>
        <div className="space-y-1 text-sm">
          <p>
            <span className="text-gray-500">DCC</span>{' '}
            <span className="font-semibold text-gray-200">{train.DCC_ID}</span>
          </p>
          <p>
            <span className="text-gray-500">Length</span>{' '}
            <span className="font-semibold text-gray-200">{train.Length} mm</span>
          </p>
          <p>
            <span className="text-gray-500">Calibrated speed (step {step})</span>{' '}
            <span className="font-semibold text-gray-200">{calc} mm/s</span>
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <FunctionButtons trains={[train]} fixedCab={train.DCC_ID} size="md" layout="horizontal" />
        </div>
      </div>
      <div className="ml-4 flex h-32 w-24 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-[#30363d]">
        <span className="text-[10px] italic text-gray-600">No photo</span>
      </div>
    </div>
  );
}
