import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { SelectedTrainContext } from '../context/SelectedTrainContext.jsx';

function labelForFn(fn) {
  const s = String(fn);
  return s.toUpperCase().startsWith('F') ? s : `F${s}`;
}

export function FunctionButtons({ trains, layout = 'portrait', size = 'lg', fixedCab = null }) {
  const socket = useSocket();
  const fleet = useContext(SelectedTrainContext);
  const [onMap, setOnMap] = useState(() => ({}));

  if (fixedCab == null && fleet == null) {
    throw new Error('FunctionButtons in fleet mode requires SelectedTrainProvider');
  }

  const isPortrait = layout === 'portrait';
  const buttonPadding = isPortrait ? (size === 'lg' ? 'px-3.5 py-2' : 'px-3 py-1.5') : 'px-2.5 py-1.5';
  const buttonTextSize = isPortrait ? (size === 'lg' ? 'text-sm' : 'text-xs') : 'text-xs';

  const shapeClass = isPortrait
    ? 'inline-flex min-w-14 rounded-lg cursor-pointer items-center justify-center border font-semibold tracking-wide shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors'
    : 'inline-flex shrink-0 rounded-md cursor-pointer items-center justify-center border font-semibold tracking-wide shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors';

  const cabForRow =
    fixedCab != null ? String(fixedCab) : String(fleet.selectedCab);
  const train = useMemo(
    () => trains.find((t) => String(t.DCC_ID) === cabForRow),
    [trains, cabForRow],
  );

  const functionNumbers = useMemo(() => {
    if (!train || !train.Functions) {
      return [];
    }
    return train.Functions.map((fn) => String(fn).trim()).filter((fn) => fn.length > 0);
  }, [train]);

  useEffect(() => {
    const onFunction = ({ cab, fn, on }) => {
      const key = `${cab}:${fn}`;
      setOnMap((prev) => ({ ...prev, [key]: Boolean(on) }));
    };

    const onStatus = (status) => {
      const enabledFunctionsByCab = status.enabledFunctionsByCab || {};
      setOnMap((prev) => {
        const next = { ...prev };
        Object.entries(enabledFunctionsByCab).forEach(([cab, fnStates]) => {
          Object.entries(fnStates).forEach(([fn, on]) => {
            next[`${cab}:${fn}`] = Boolean(on);
          });
        });
        return next;
      });
    };

    socket.on('dcc:function', onFunction);
    socket.on('dcc:status', onStatus);
    socket.emit('dcc:status');

    return () => {
      socket.off('dcc:function', onFunction);
      socket.off('dcc:status', onStatus);
    };
  }, [socket]);

  const toggleFn = useCallback(
    (fnKey, trainId) => {
      socket.emit('dcc:function', { cab: trainId, function: fnKey });
    },
    [socket],
  );

  const rootClass = [
    'mt-4',
    isPortrait ? 'grid grid-cols-2 gap-2.5' : 'flex w-full flex-nowrap gap-2 overflow-x-auto pb-1',
  ].join(' ');

  if (!train) {
    return <div className={rootClass} />;
  }

  return (
    <div className={rootClass}>
      {functionNumbers.map((fn) => {
        const k = `${train.DCC_ID}:${fn}`;
        const isOn = onMap[k];
        return (
          <button
            key={fn}
            type="button"
            className={`${shapeClass} ${buttonPadding} ${buttonTextSize} ${
              isOn
                ? 'border-green-500 text-green-300'
                : 'border-amber-500/50 bg-slate-900 text-amber-300'
            }`}
            onClick={() => toggleFn(fn, String(train.DCC_ID))}
          >
            {labelForFn(fn)}
          </button>
        );
      })}
    </div>
  );
}
