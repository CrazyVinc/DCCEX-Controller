import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { useSelectedTrain } from '../context/SelectedTrainContext.jsx';

function getSpeedStepLabels(maxSpeed) {
  return [
    maxSpeed,
    Math.round(maxSpeed * 0.75),
    Math.round(maxSpeed * 0.5),
    Math.round(maxSpeed * 0.25),
    0,
  ];
}

const forwardClass =
  'absolute left-1/2 top-1/2 w-96 max-w-none -translate-x-1/2 -translate-y-1/2 -rotate-90 cursor-pointer appearance-none accent-emerald-500 h-14 [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:-mt-[16px] [&::-webkit-slider-thumb]:h-10 [&::-webkit-slider-thumb]:w-14 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-xl [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-slate-700 [&::-webkit-slider-thumb]:bg-emerald-400 [&::-webkit-slider-thumb]:shadow-[0_0_16px_rgba(52,211,153,0.85),0_2px_8px_rgba(0,0,0,0.45)] [&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent [&::-moz-range-thumb]:h-10 [&::-moz-range-thumb]:w-14 [&::-moz-range-thumb]:rounded-xl [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-slate-700 [&::-moz-range-thumb]:bg-emerald-400 [&::-moz-range-thumb]:shadow-[0_0_16px_rgba(52,211,153,0.85),0_2px_8px_rgba(0,0,0,0.45)]';

const reverseClass =
  'absolute left-1/2 top-1/2 w-96 max-w-none -translate-x-1/2 -translate-y-1/2 -rotate-90 cursor-pointer appearance-none accent-rose-500 h-14 [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:-mt-[16px] [&::-webkit-slider-thumb]:h-10 [&::-webkit-slider-thumb]:w-14 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-xl [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-slate-700 [&::-webkit-slider-thumb]:bg-rose-400 [&::-webkit-slider-thumb]:shadow-[0_0_16px_rgba(251,113,133,0.85),0_2px_8px_rgba(0,0,0,0.45)] [&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent [&::-moz-range-thumb]:h-10 [&::-moz-range-thumb]:w-14 [&::-moz-range-thumb]:rounded-xl [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-slate-700 [&::-moz-range-thumb]:bg-rose-400 [&::-moz-range-thumb]:shadow-[0_0_16px_rgba(251,113,133,0.85),0_2px_8px_rgba(0,0,0,0.45)]';

function SpeedColumn({ ariaLabel, accentBorder, accentShadow, value, onChange, inputClass, maxSpeed }) {
  const speedStepLabels = getSpeedStepLabels(maxSpeed);

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-stretch gap-4 rounded-3xl border border-slate-700/90 bg-slate-900/95 px-5 py-6 shadow-[inset_0_1px_0_0_rgba(148,163,184,0.08)] sm:gap-5 sm:px-6">
        <div className="relative h-96 w-13 shrink-0 sm:h-112 sm:w-15">
          <div
            className={`pointer-events-none absolute inset-0 rounded-full border-2 ${accentBorder} bg-black/85 ${accentShadow}`}
          />
          <input
            type="range"
            min={0}
            max={maxSpeed}
            step={1}
            value={value}
            aria-label={ariaLabel}
            className={inputClass}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </div>
        <div
          className="flex h-96 min-w-8 flex-col justify-between py-0.5 text-left font-mono text-xs tabular-nums tracking-wide text-slate-400 select-none sm:h-112 sm:min-w-9"
          aria-hidden="true"
        >
          {speedStepLabels.map((s) => (
            <span key={s} className="leading-none">
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export const SpeedControls = forwardRef(function SpeedControls({ onMeterChange, maxSpeed = 126 }, ref) {
  const socket = useSocket();
  const { selectedCab } = useSelectedTrain();
  const throttleByCab = useRef({});
  const [forward, setForward] = useState(0);
  const [reverse, setReverse] = useState(0);

  const setMeter = (text) => {
    onMeterChange(text);
  };

  const applyThrottleToControls = (cab) => {
    if (cab == null) {
      return;
    }
    const throttle = throttleByCab.current[String(cab)] || { speed: 0, dir: 0 };
    const speed = Math.min(Number(throttle.speed) || 0, maxSpeed);
    const dir = Number(throttle.dir) === 0 ? 0 : 1;
    setForward(dir === 1 ? speed : 0);
    setReverse(dir === 0 ? speed : 0);
    setMeter(dir === 0 && speed > 0 ? `-${speed}` : String(speed));
  };

  useEffect(() => {
    const onStatus = ({ throttleByCab: t }) => {
      if (!t || typeof t !== 'object') {
        return;
      }
      throttleByCab.current = { ...throttleByCab.current, ...t };
      applyThrottleToControls(selectedCab);
    };

    const onThrottle = ({ cab, speed, dir }) => {
      if (cab === undefined || cab === null) {
        return;
      }
      throttleByCab.current[String(cab)] = { speed, dir };
      if (String(cab) === String(selectedCab)) {
        applyThrottleToControls(selectedCab);
      }
    };

    socket.on('dcc:status', onStatus);
    socket.on('dcc:throttle', onThrottle);

    return () => {
      socket.off('dcc:status', onStatus);
      socket.off('dcc:throttle', onThrottle);
    };
  }, [socket, selectedCab, maxSpeed]);

  useEffect(() => {
    applyThrottleToControls(selectedCab);
  }, [selectedCab, maxSpeed]);

  const cab = selectedCab;

  const emergencyStop = () => {
    socket.emit('dcc:setThrottle', { cab, speed: 0, dir: 0 });
    setForward(0);
    setReverse(0);
    setMeter('0');
  };

  useImperativeHandle(ref, () => ({ emergencyStop }), [cab, socket]);

  const onForwardInput = (speed) => {
    setForward(speed);
    setReverse(0);
    setMeter(String(speed));
    socket.emit('dcc:setThrottle', { cab, speed, dir: 1 });
  };

  const onReverseInput = (speed) => {
    setReverse(speed);
    setForward(0);
    setMeter(`-${speed}`);
    socket.emit('dcc:setThrottle', { cab, speed, dir: 0 });
  };

  return (
    <div className="flex flex-wrap items-center justify-center gap-10 py-6 sm:gap-16">
      <div className="flex flex-col items-center">
        <SpeedColumn
          ariaLabel="Forward speed"
          accentBorder="border-emerald-400"
          accentShadow="shadow-[0_0_18px_rgba(52,211,153,0.45),0_0_42px_rgba(52,211,153,0.12)]"
          value={forward}
          onChange={onForwardInput}
          inputClass={forwardClass}
          maxSpeed={maxSpeed}
        />
        <span className="mt-4 font-medium tracking-wide text-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.35)]">
          Forward
        </span>
      </div>
      <div className="flex flex-col items-center">
        <SpeedColumn
          ariaLabel="Reverse speed"
          accentBorder="border-rose-400"
          accentShadow="shadow-[0_0_18px_rgba(251,113,133,0.45),0_0_42px_rgba(251,113,133,0.12)]"
          value={reverse}
          onChange={onReverseInput}
          inputClass={reverseClass}
          maxSpeed={maxSpeed}
        />
        <span className="mt-4 font-medium tracking-wide text-rose-400 drop-shadow-[0_0_12px_rgba(251,113,133,0.35)]">
          Reverse
        </span>
      </div>
    </div>
  );
});
