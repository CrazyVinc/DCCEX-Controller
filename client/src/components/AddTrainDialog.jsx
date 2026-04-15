import { useEffect, useRef, useState } from 'react';

function parseNum(raw) {
  const n = parseFloat(String(raw).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

export function AddTrainDialog({ open, onClose, onSaved }) {
  const dialogRef = useRef(null);
  const [calDisplay, setCalDisplay] = useState('—');

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

  const updateCalculated = (form) => {
    if (!form) {
      return;
    }
    const durationSec = parseNum(form.calDurationSec?.value);
    const distanceCm = parseNum(form.calDistanceCm?.value);
    if (!(distanceCm > 0) || !(durationSec > 0)) {
      setCalDisplay('—');
      return;
    }
    setCalDisplay(((distanceCm * 10) / durationSec).toFixed(2));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const duration = parseNum(form.calDurationSec.value);
    const distanceCm = parseNum(form.calDistanceCm.value);
    const payload = {
      DCC_ID: form.dccAddress.value,
      Name: form.trainName.value,
      Length: parseNum(form.lengthMm.value),
      Speed: {
        Duration: duration,
        Distance: distanceCm,
        Step: 1,
        calculated: (distanceCm * 10) / duration,
      },
      startDelay: parseNum(form.startDelaySec.value) || 0,
      Functions: form.fKeys.value
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f !== ''),
      Notes: form.notes.value,
      Meta: JSON.parse(form.metadataJson.value || '{}'),
    };

    const response = await fetch('/api/addTrain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      onSaved();
      onClose();
      form.reset();
      setCalDisplay('—');
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 m-auto max-h-[min(90vh,900px)] w-full max-w-lg rounded-lg border border-[#ff9d00] bg-[#0d1117] p-0 text-gray-300 shadow-xl backdrop:bg-gray-800/50 open:flex open:max-h-[min(90vh,900px)] open:flex-col"
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          dialogRef.current.close();
        }
      }}
    >
      <div className="flex max-h-[min(90vh,900px)] flex-col overflow-hidden">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#30363d] px-5 py-4">
          <h2 className="text-lg font-bold uppercase tracking-wider text-[#ff9d00]">TRAIN</h2>
          <button
            type="button"
            className="m-0 p-0"
            aria-label="Close"
            onClick={() => dialogRef.current?.close()}
          >
            &times;
          </button>
        </header>

        <form id="train-form" className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="train-dcc-address" className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  DCC address (decoder)
                </label>
                <input
                  id="train-dcc-address"
                  name="dccAddress"
                  type="text"
                  inputMode="numeric"
                  placeholder="3"
                  className="w-full rounded-md border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:border-[#ff9d00] focus:outline-none focus:ring-1 focus:ring-[#ff9d00]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="train-name" className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  Train name
                </label>
                <p className="text-xs text-gray-500">
                  What you see in the roster and cab (e.g. <span className="font-medium text-gray-400">Big Boy</span>
                  ). This does <span className="font-medium text-gray-400">not</span> change the DCC number.
                </p>
                <input
                  id="train-name"
                  name="trainName"
                  type="text"
                  placeholder="BR003"
                  className="w-full rounded-md border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:border-[#ff9d00] focus:outline-none focus:ring-1 focus:ring-[#ff9d00]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="train-length-mm" className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  Length (mm)
                </label>
                <p className="text-xs text-gray-500">
                  Full length in <span className="font-medium text-gray-400">millimeters</span> — same unit as track
                  segments in{' '}
                  <code className="rounded bg-[#21262d] px-1 py-0.5 text-[11px] text-gray-400">layout.json</code>. Do
                  not enter meters (e.g. use{' '}
                  <code className="rounded bg-[#21262d] px-1 py-0.5 text-[11px] text-gray-400">1200</code> for 1.2 m).
                </p>
                <input
                  id="train-length-mm"
                  name="lengthMm"
                  type="text"
                  inputMode="decimal"
                  placeholder="275"
                  className="w-full rounded-md border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:border-[#ff9d00] focus:outline-none focus:ring-1 focus:ring-[#ff9d00]"
                />
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Speed calibration at step 1</p>
                <p className="text-xs text-gray-500">
                  Time to cover a known distance (distance in cm; stored as mm/s) at Märklin speed step 1.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="train-cal-duration" className="text-xs text-gray-500">
                      Duration (s)
                    </label>
                    <input
                      id="train-cal-duration"
                      name="calDurationSec"
                      type="text"
                      inputMode="decimal"
                      placeholder="9"
                      onInput={(e) => updateCalculated(e.currentTarget.form)}
                      className="w-full rounded-md border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:border-[#ff9d00] focus:outline-none focus:ring-1 focus:ring-[#ff9d00]"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="train-cal-distance" className="text-xs text-gray-500">
                      Distance (cm)
                    </label>
                    <input
                      id="train-cal-distance"
                      name="calDistanceCm"
                      type="text"
                      inputMode="decimal"
                      placeholder="60"
                      onInput={(e) => updateCalculated(e.currentTarget.form)}
                      className="w-full rounded-md border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:border-[#ff9d00] focus:outline-none focus:ring-1 focus:ring-[#ff9d00]"
                    />
                  </div>
                </div>
                <div className="rounded-md border border-[#ff9d00] bg-[#161b22] px-3 py-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                    Calculated speed (saved as mm/s)
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-[#ff9d00]">
                    <span>{calDisplay}</span>{' '}
                    <span className="text-base font-normal text-gray-400">mm/s</span>
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="train-start-delay" className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  Start delay (s)
                </label>
                <p className="text-xs text-gray-500">
                  After you select a speed (e.g. step 1), some locs take this long before they actually roll. Leave empty
                  if none.
                </p>
                <input
                  id="train-start-delay"
                  name="startDelaySec"
                  type="text"
                  inputMode="decimal"
                  placeholder="optional"
                  className="w-full rounded-md border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:border-[#ff9d00] focus:outline-none focus:ring-1 focus:ring-[#ff9d00]"
                />
              </div>

              <div className="flex items-start gap-3">
                <input
                  id="train-swap-fwd-rev"
                  name="swapFwdRev"
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#30363d] bg-[#161b22] text-[#ff9d00] focus:ring-[#ff9d00]"
                />
                <label
                  htmlFor="train-swap-fwd-rev"
                  className="text-sm uppercase leading-snug tracking-wide text-gray-400"
                >
                  Swap FWD / REV (decoder direction inverted)
                </label>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="train-f-keys" className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  F-keys (comma-separated, 1-28)
                </label>
                <input
                  id="train-f-keys"
                  name="fKeys"
                  type="text"
                  placeholder="1, 2, 3, 4"
                  className="w-full rounded-md border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:border-[#ff9d00] focus:outline-none focus:ring-1 focus:ring-[#ff9d00]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="train-notes" className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  Notes
                </label>
                <textarea
                  id="train-notes"
                  name="notes"
                  rows={3}
                  className="w-full resize-y rounded-md border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:border-[#ff9d00] focus:outline-none focus:ring-1 focus:ring-[#ff9d00]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="train-metadata" className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  Metadata (JSON object)
                </label>
                <textarea
                  id="train-metadata"
                  name="metadataJson"
                  rows={3}
                  placeholder="{}"
                  className="w-full resize-y rounded-md border border-[#30363d] bg-[#161b22] px-3 py-2 font-mono text-sm text-gray-200 placeholder:text-gray-500 focus:border-[#ff9d00] focus:outline-none focus:ring-1 focus:ring-[#ff9d00]"
                />
              </div>
            </div>
          </div>

          <footer className="flex shrink-0 flex-wrap items-stretch gap-3 border-t border-[#30363d] bg-[#0d1117] px-5 py-4">
            <button
              type="submit"
              className="min-h-12 min-w-0 flex-1 rounded-md bg-[#00c896] px-4 py-3 text-center text-sm font-bold uppercase tracking-wide text-black transition-opacity hover:opacity-90"
            >
              Save
            </button>
            <button
              type="button"
              className="min-h-12 shrink-0 rounded-md border-2 border-red-500 bg-[#161b22] px-4 py-3 text-sm font-bold uppercase tracking-wide text-red-500 transition-colors hover:bg-red-950/30"
            >
              Delete
            </button>
          </footer>
        </form>
      </div>
    </dialog>
  );
}
