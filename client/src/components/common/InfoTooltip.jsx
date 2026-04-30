import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const HOVER_OPEN_MS = 1500;
const LEAVE_CLOSE_MS = 200;

export function InfoTooltip({ text }) {
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
