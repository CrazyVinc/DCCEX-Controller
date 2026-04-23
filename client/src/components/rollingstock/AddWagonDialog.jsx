import { useEffect, useRef } from 'react';

function parseNum(raw) {
  const n = parseFloat(String(raw).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

export function AddWagonDialog({ open, onClose, onSaved }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) {
      return;
    }
    const handleClose = () => onClose();
    d.addEventListener('close', handleClose);
    return () => d.removeEventListener('close', handleClose);
  }, [onClose]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) {
      return;
    }
    if (open && !d.open) {
      d.showModal();
    }
    if (!open && d.open) {
      d.close();
    }
  }, [open]);

  const onSubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const payload = {
      Name: form.wagonName.value.trim(),
      Length: parseNum(form.lengthMm.value),
    };

    const response = await fetch('/api/wagons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      onSaved();
      onClose();
      form.reset();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 m-auto max-h-[min(90vh,900px)] w-full max-w-lg rounded-2xl border border-slate-700/80 bg-[#0d1424] p-0 text-slate-300 shadow-[0_0_24px_rgba(56,189,248,0.1)] backdrop:bg-slate-900/70 open:flex open:max-h-[min(90vh,900px)] open:flex-col"
      onClick={(ev) => {
        if (ev.target === dialogRef.current) {
          dialogRef.current.close();
        }
      }}
    >
      <div className="flex max-h-[min(90vh,900px)] flex-col overflow-hidden">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-700/80 px-5 py-4">
          <h2 className="text-lg font-bold uppercase tracking-wider text-sky-200">Wagon</h2>
          <button
            type="button"
            className="m-0 p-0 text-slate-400 hover:text-slate-200"
            aria-label="Close"
            onClick={() => dialogRef.current?.close()}
          >
            &times;
          </button>
        </header>
        <form id="wagon-form" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1.5 text-xs uppercase tracking-wide text-slate-400">
            Name
            <input
              id="wagon-name"
              name="wagonName"
              required
              className="rounded-md border border-slate-700/80 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs uppercase tracking-wide text-slate-400">
            Length (mm)
            <input
              id="wagon-length-mm"
              name="lengthMm"
              type="text"
              inputMode="decimal"
              required
              className="rounded-md border border-slate-700/80 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
            />
          </label>
        </form>
        <footer className="flex shrink-0 justify-end gap-3 border-t border-slate-700/80 px-5 py-4">
          <button
            type="button"
            className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-300"
            onClick={() => dialogRef.current?.close()}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="wagon-form"
            className="rounded-md border border-sky-400/80 bg-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-wide text-slate-900 hover:bg-sky-400"
          >
            Add wagon
          </button>
        </footer>
      </div>
    </dialog>
  );
}
