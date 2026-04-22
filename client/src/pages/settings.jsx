import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { FunctionButtons } from '../components/FunctionButtons.jsx';
import { PowerPanel } from '../components/PowerPanel.jsx';
import { SelectedTrainProvider, useSelectedTrain } from '../context/SelectedTrainContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { SpeedControls } from '../components/SpeedControls.jsx';
import { TrainPicker } from '../components/TrainPicker.jsx';
import { Section } from '../components/Section.jsx';
import { toast } from 'sonner';

const HOVER_OPEN_MS = 1500;
const LEAVE_CLOSE_MS = 200;

function InfoTooltip({ text }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const tooltipId = useId();
  const triggerRef = useRef(null);
  const hoverOpenTimerRef = useRef(null);
  const closeDelayTimerRef = useRef(null);

  const clearTimers = () => {
    clearTimeout(hoverOpenTimerRef.current);
    clearTimeout(closeDelayTimerRef.current);
    hoverOpenTimerRef.current = null;
    closeDelayTimerRef.current = null;
  };

  const scheduleClose = () => {
    clearTimeout(closeDelayTimerRef.current);
    closeDelayTimerRef.current = setTimeout(() => setOpen(false), LEAVE_CLOSE_MS);
  };

  const cancelClose = () => {
    clearTimeout(closeDelayTimerRef.current);
    closeDelayTimerRef.current = null;
  };

  const updateCoords = () => {
    const el = triggerRef.current;
    if (!el) {
      return;
    }
    const r = el.getBoundingClientRect();
    setCoords({ top: r.bottom + 8, left: r.left });
  };

  useEffect(() => () => clearTimers(), []);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    updateCoords();
    const onReposition = () => updateCoords();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  const onTriggerEnter = () => {
    cancelClose();
    clearTimeout(hoverOpenTimerRef.current);
    hoverOpenTimerRef.current = setTimeout(() => setOpen(true), HOVER_OPEN_MS);
  };

  const onTriggerLeave = () => {
    clearTimeout(hoverOpenTimerRef.current);
    hoverOpenTimerRef.current = null;
    scheduleClose();
  };

  const onTooltipEnter = () => {
    cancelClose();
  };

  const onTooltipLeave = () => {
    scheduleClose();
  };

  const onToggleClick = (e) => {
    e.preventDefault();
    clearTimers();
    setOpen((prev) => !prev);
  };

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex"
        onMouseEnter={onTriggerEnter}
        onMouseLeave={onTriggerLeave}
      >
        <button
          type="button"
          aria-label="Show info"
          aria-expanded={open}
          aria-describedby={open ? tooltipId : undefined}
          onClick={onToggleClick}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-600 text-[11px] font-semibold text-amber-300 transition-colors hover:border-amber-300/70 hover:text-amber-200"
        >
          i
        </button>
      </span>
      {open &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            style={{ position: 'fixed', top: coords.top, left: coords.left, zIndex: 9999 }}
            className="pointer-events-auto max-w-xs rounded-md border border-slate-700/80 bg-[#0d1424] px-3 py-2 text-xs text-slate-200 shadow-lg"
            onMouseEnter={onTooltipEnter}
            onMouseLeave={onTooltipLeave}
          >
            {text}
          </div>,
          document.body
        )}
    </>
  );
}

export function Settings() {
  const [startupFunctionEnabled, setStartupFunctionEnabled] = useState(false);
  const [functionKeys, setFunctionKeys] = useState('');
  const [globalSpeedCab, setGlobalSpeedCab] = useState(127);
  const [showGlobalSpeedTooltip, setShowGlobalSpeedTooltip] = useState(false);
  const globalSpeedPercent = (globalSpeedCab / 127) * 100;

  useEffect(() => {
    async function loadSettings() {
      const response = await fetch('/api/settings');
      if (!response.ok) {
        toast.error('Failed to load settings.');
        return;
      }
      const result = await response.json();
      setFunctionKeys(result.data.FunctionOnStarts.keys.join(', '));
      setStartupFunctionEnabled(result.data.FunctionOnStarts.enabled);
      setGlobalSpeedCab(Number(result.data.GlobalSpeedCab ?? 127));
    }

    loadSettings();
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    const settings = {
      FunctionOnStarts: {
        keys: functionKeys.split(',').map((key) => key.trim()).filter((key) => key !== '').map((key) => Number(key)).filter((key) => !Number.isNaN(key)),
        enabled: startupFunctionEnabled,
      },
      GlobalSpeedCab: Number(globalSpeedCab),
    };
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    if (response.ok) {
      toast.success('Settings updated successfully.');
    } else {
      toast.error('Failed to update settings.');
    }
  };


  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <Section title="Settings">
        <form id="settings-form" className="flex flex-1 flex-col" onSubmit={onSubmit}>
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <label htmlFor="light-functionkey" className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Function to start on startup.
                  </label>
                  <InfoTooltip text={<>
                      Set the function key number (e.g., 0 for lights) that should be enabled automatically when the app starts.<br />
                      The train must also have this function listed in its F-KEYS in Rolling Stock to be actually enabled.<br/>
                  </>} />
             
             
                </div>
                <div className="flex w-full min-w-0 items-stretch overflow-hidden rounded-md border border-slate-700/80 bg-slate-900/40 focus-within:border-amber-300 focus-within:ring-1 focus-within:ring-amber-300">
                  <input
                    id="light-functionkey"
                    name="functionkey"
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-0"
                    value={functionKeys}
                    onChange={(event) => setFunctionKeys(event.target.value)}
                  />
                  <div className="flex shrink-0 items-center gap-2 border-l border-slate-700/80 px-3">
                    <input
                      id="startup-function-enabled"
                      name="startupFunctionEnabled"
                      type="checkbox"
                      checked={startupFunctionEnabled}
                      onChange={(event) => setStartupFunctionEnabled(event.target.checked)}
                      className="h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-900 text-amber-300 focus:ring-amber-300"
                    />
                    <label htmlFor="startup-function-enabled" className="whitespace-nowrap text-xs font-medium text-slate-400">
                      Run on startup
                    </label>
                  </div>
                </div>
                <small className="block text-xs leading-snug text-slate-500">
                  Use a comma-separated list for multiple functions (e.g. <code className="font-mono text-slate-300">0, 1, 2</code>).
                </small>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="global-speed-cab" className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Global speed cab
                  </label>
                </div>
                <div className="relative w-full">
                  {showGlobalSpeedTooltip ? (
                    <span
                      className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded bg-slate-800 px-2 py-1 text-xs font-semibold text-amber-300"
                      style={{ left: `${globalSpeedPercent}%` }}
                    >
                      {globalSpeedCab}
                    </span>
                  ) : null}
                  <input
                    id="global-speed-cab"
                    name="globalSpeedCab"
                    type="range"
                    min={0}
                    max={127}
                    step={1}
                    value={globalSpeedCab}
                    onChange={(event) => setGlobalSpeedCab(Number(event.target.value))}
                    onMouseDown={() => setShowGlobalSpeedTooltip(true)}
                    onMouseUp={() => setShowGlobalSpeedTooltip(false)}
                    onMouseLeave={() => setShowGlobalSpeedTooltip(false)}
                    onTouchStart={() => setShowGlobalSpeedTooltip(true)}
                    onTouchEnd={() => setShowGlobalSpeedTooltip(false)}
                    onFocus={() => setShowGlobalSpeedTooltip(true)}
                    onBlur={() => setShowGlobalSpeedTooltip(false)}
                    className="h-2 w-full cursor-pointer appearance-none rounded-md bg-slate-700/80 outline-none accent-amber-300"
                  />
                </div>
                <small className="block text-xs leading-snug text-slate-500">
                  Global cab speed step (0-127).
                </small>
              </div>
            </div>
          </div>
          <div className="mt-6 flex shrink-0 border-b border-slate-700/80 pb-4">
            <button
              type="submit"
              className="rounded-md border border-emerald-400/80 bg-emerald-400 px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-slate-900 transition-colors hover:bg-emerald-300"
            >
              Save settings
            </button>
          </div>
        </form>
      </Section>
    </main>
  );
}
