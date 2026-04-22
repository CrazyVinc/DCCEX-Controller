import { useEffect, useMemo, useRef, useState } from 'react';
import { Hr } from '../common/Hr.jsx';

function parseNum(raw) {
  const n = parseFloat(String(raw).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

const TRAIN_SPEED_LIMIT_MAX = 127;

export function EditTrainDialog({ open, train, initialTab = 'details', onClose, onSaved }) {
  const dialogRef = useRef(null);
  const [tab, setTab] = useState('details');
  const [formValues, setFormValues] = useState({
    Name: '',
    Length: '',
    Duration: '',
    Distance: '',
    startDelay: '',
    Functions: '',
    Notes: '',
    Meta: '{}',
  });
  const [images, setImages] = useState([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [speedCabValue, setSpeedCabValue] = useState(127);
  const [showSpeedCabTooltip, setShowSpeedCabTooltip] = useState(false);
  const speedCabPercent = (speedCabValue / TRAIN_SPEED_LIMIT_MAX) * 100;

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

  useEffect(() => {
    if (!open || !train) {
      return;
    }
    setTab(initialTab);
    setFormValues({
      Name: train.Name ?? '',
      Length: String(train.Length ?? ''),
      Duration: String(train.Speed?.Duration ?? ''),
      Distance: String(train.Speed?.Distance ?? ''),
      startDelay: String(train.startDelay ?? ''),
      Functions: (train.Functions ?? []).join(', '),
      Notes: train.Notes ?? '',
      Meta: JSON.stringify(train.Meta ?? {}, null, 2),
    });
    setSpeedCabValue(Number(train.Speed?.limit ?? TRAIN_SPEED_LIMIT_MAX));
    // Intentionally not depending on `train` identity: parent `load()` replaces the object after saves while the dialog stays open.
  }, [open, train?.DCC_ID, train?.Speed?.limit, initialTab]);

  const saveSpeedCabLimit = async ({ refreshList = false } = {}) => {
    const response = await fetch(`/api/trains/${train.DCC_ID}/speed-limit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speedLimit: speedCabValue }),
    });
    if (!response.ok) {
      return;
    }
    if (refreshList) {
      await onSaved();
    }
  };

  const loadImages = async () => {
    if (!train) {
      return;
    }
    const response = await fetch(`/api/trains/${train.DCC_ID}/images`);
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    setImages(data.data);
    setSelectedImageIndex(0);
  };

  useEffect(() => {
    if (open && train && tab === 'images') {
      loadImages();
    }
  }, [open, train?.DCC_ID, tab]);

  const calDisplay = useMemo(() => {
    if (!formValues) {
      return '—';
    }
    const durationSec = parseNum(formValues.Duration);
    const distanceCm = parseNum(formValues.Distance);
    if (!(durationSec > 0) || !(distanceCm > 0)) {
      return '—';
    }
    return ((distanceCm * 10) / durationSec).toFixed(2);
  }, [formValues]);

  const moveImage = async (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= images.length) {
      return;
    }
    const next = [...images];
    const [current] = next.splice(index, 1);
    next.splice(newIndex, 0, current);
    setImages(next);
    setSelectedImageIndex(newIndex);

    await fetch(`/api/trains/${train.DCC_ID}/images/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: next.map((image) => image.name) }),
    });
    await loadImages();
    await onSaved();
  };

  const uploadImages = async (fileList) => {
    const files = Array.from(fileList);
    for (const file of files) {
      const formData = new FormData();
      formData.append('image', file);
      await fetch(`/api/trains/${train.DCC_ID}/images`, {
        method: 'POST',
        body: formData,
      });
    }
    await loadImages();
    await onSaved();
  };

  const deleteImage = async (index) => {
    const image = images[index];
    if (!image) {
      return;
    }
    await fetch(`/api/trains/${train.DCC_ID}/images/${encodeURIComponent(image.name)}`, {
      method: 'DELETE',
    });
    await loadImages();
    await onSaved();
    setSelectedImageIndex((currentIndex) => {
      if (images.length <= 1) {
        return 0;
      }
      return Math.min(currentIndex, images.length - 2);
    });
  };

  const saveDetails = async () => {
    const duration = parseNum(formValues.Duration);
    const distanceCm = parseNum(formValues.Distance);

    const payload = {
      Name: formValues.Name,
      Length: parseNum(formValues.Length),
      Speed: {
        Duration: Number.isNaN(duration) ? null : duration,
        Distance: Number.isNaN(distanceCm) ? null : distanceCm,
        Step: 1,
        calculated: Number.isNaN(duration) || Number.isNaN(distanceCm) || duration <= 0
          ? null
          : (distanceCm * 10) / duration,
      },
      startDelay: parseNum(formValues.startDelay) || 0,
      Functions: formValues.Functions.split(',')
        .map((f) => f.trim())
        .filter((f) => f !== ''),
      Notes: formValues.Notes,
      Meta: JSON.parse(formValues.Meta || '{}'),
    };
    const response = await fetch(`/api/trains/${train.DCC_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      await saveSpeedCabLimit({ refreshList: false });
      await onSaved();
      onClose();
    }
  };

  const deleteTrain = async () => {
    const label = (formValues.Name || train.Name || '').trim() || `DCC ${train.DCC_ID}`;
    if (!window.confirm(`Delete train “${label}” (${train.DCC_ID}) permanently?`)) {
      return;
    }
    const response = await fetch(`/api/trains/${train.DCC_ID}`, { method: 'DELETE' });
    if (response.ok) {
      await onSaved();
      onClose();
    }
  };

  if (!train) {
    return null;
  }

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 m-auto max-h-[90vh] w-full max-w-3xl rounded-2xl border border-slate-700/80 bg-[#0d1424] p-0 text-slate-300 shadow-[0_0_24px_rgba(56,189,248,0.1)] backdrop:bg-slate-900/70 open:flex open:flex-col"
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current.close();
        }
      }}
    >
      <div className="flex items-center justify-between border-b border-slate-700/80 px-5 py-4">
        <h2 className="text-lg font-bold uppercase tracking-wider text-amber-300">
          Edit train {train.DCC_ID}
        </h2>
        <button type="button" className="m-0 p-0" aria-label="Close" onClick={() => dialogRef.current?.close()}>
          &times;
        </button>
      </div>

      <div className="flex gap-2 border-b border-slate-700/80 px-5 py-3">
        <button
          type="button"
          onClick={() => setTab('details')}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold ${tab === 'details' ? 'bg-amber-300 text-slate-900' : 'bg-slate-800 text-slate-300'}`}
        >
          Details
        </button>
        <button
          type="button"
          onClick={() => setTab('images')}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold ${tab === 'images' ? 'bg-amber-300 text-slate-900' : 'bg-slate-800 text-slate-300'}`}
        >
          Images
        </button>
      </div>

      {tab === 'details' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs uppercase tracking-wide text-slate-400">
                Name
                <input
                  value={formValues.Name ?? ''}
                  onChange={(event) => setFormValues({ ...formValues, Name: event.target.value })}
                  className="rounded-md border border-slate-700/80 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 focus:border-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-300"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs uppercase tracking-wide text-slate-400">
                Length (mm)
                <input
                  value={formValues.Length ?? ''}
                  onChange={(event) => setFormValues({ ...formValues, Length: event.target.value })}
                  className="rounded-md border border-slate-700/80 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 focus:border-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-300"
                />
              </label>
            </div>

            <div className="space-y-4 rounded-xl border border-slate-800/90 bg-[#060a12] p-4 shadow-[inset_0_1px_0_0_rgba(15,23,42,0.5)]">
              <Hr text="Speed" />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-xs uppercase tracking-wide text-slate-400">
                  Duration (s)
                  <input
                    value={formValues.Duration ?? ''}
                    onChange={(event) => setFormValues({ ...formValues, Duration: event.target.value })}
                    className="rounded-md border border-slate-800 bg-[#04060c] px-3 py-2 text-sm text-slate-200 focus:border-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-300"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-xs uppercase tracking-wide text-slate-400">
                  Distance (cm)
                  <input
                    value={formValues.Distance ?? ''}
                    onChange={(event) => setFormValues({ ...formValues, Distance: event.target.value })}
                    className="rounded-md border border-slate-800 bg-[#04060c] px-3 py-2 text-sm text-slate-200 focus:border-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-300"
                  />
                </label>
              </div>

              <div className="rounded-md border border-amber-300/35 bg-[#04060c] px-3 py-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Calculated</p>
                <p className="mt-1 text-2xl font-semibold text-amber-300">
                  {calDisplay} <span className="text-base font-normal text-slate-400">mm/s</span>
                </p>
              </div>

              <div className="rounded-md border border-slate-800 bg-[#04060c] px-3 py-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Speed cab</span>
                </div>
                <div className="relative w-full">
                  {showSpeedCabTooltip ? (
                    <span
                      className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded bg-slate-900 px-2 py-1 text-xs font-semibold text-amber-300 ring-1 ring-slate-700"
                      style={{ left: `${speedCabPercent}%` }}
                    >
                      {speedCabValue}
                    </span>
                  ) : null}
                  <input
                    type="range"
                    min={0}
                    max={TRAIN_SPEED_LIMIT_MAX}
                    step={1}
                    value={speedCabValue}
                    onChange={(event) => setSpeedCabValue(Number(event.target.value))}
                    onMouseDown={() => setShowSpeedCabTooltip(true)}
                    onMouseUp={() => {
                      setShowSpeedCabTooltip(false);
                      void saveSpeedCabLimit({ refreshList: true });
                    }}
                    onMouseLeave={() => setShowSpeedCabTooltip(false)}
                    onTouchStart={() => setShowSpeedCabTooltip(true)}
                    onTouchEnd={() => {
                      setShowSpeedCabTooltip(false);
                      void saveSpeedCabLimit({ refreshList: true });
                    }}
                    onFocus={() => setShowSpeedCabTooltip(true)}
                    onBlur={() => {
                      setShowSpeedCabTooltip(false);
                      void saveSpeedCabLimit({ refreshList: true });
                    }}
                    className="h-2 w-full cursor-pointer appearance-none rounded-md bg-slate-900 outline-none accent-amber-300"
                  />
                </div>
              </div>
            </div>

            <label className="flex flex-col gap-1.5 text-xs uppercase tracking-wide text-slate-400">
              Start delay (s)
              <input
                value={formValues.startDelay ?? ''}
                onChange={(event) => setFormValues({ ...formValues, startDelay: event.target.value })}
                className="rounded-md border border-slate-700/80 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 focus:border-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-300"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs uppercase tracking-wide text-slate-400">
              F-keys
              <input
                value={formValues.Functions ?? ''}
                onChange={(event) => setFormValues({ ...formValues, Functions: event.target.value })}
                className="rounded-md border border-slate-700/80 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 focus:border-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-300"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs uppercase tracking-wide text-slate-400">
              Notes
              <textarea
                rows={3}
                value={formValues.Notes ?? ''}
                onChange={(event) => setFormValues({ ...formValues, Notes: event.target.value })}
                className="rounded-md border border-slate-700/80 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 focus:border-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-300"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs uppercase tracking-wide text-slate-400">
              Meta (JSON)
              <textarea
                rows={4}
                value={formValues.Meta ?? '{}'}
                onChange={(event) => setFormValues({ ...formValues, Meta: event.target.value })}
                className="rounded-md border border-slate-700/80 bg-slate-900/40 px-3 py-2 font-mono text-sm text-slate-200 focus:border-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-300"
              />
            </label>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-5 py-4 md:grid-cols-[2fr_1fr]">
          <div className="space-y-3">
            <div className="aspect-video w-full overflow-hidden rounded-lg border border-slate-700/80 bg-slate-900/40">
              {images[selectedImageIndex] ? (
                <img src={images[selectedImageIndex].url} alt={images[selectedImageIndex].name} className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">No image selected</div>
              )}
            </div>
            <label className="inline-flex cursor-pointer rounded-md border border-emerald-400/80 px-3 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-400/10">
              Upload images
              <input
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  if (event.target.files?.length) {
                    uploadImages(event.target.files);
                    event.target.value = '';
                  }
                }}
              />
            </label>
          </div>
          <div className="space-y-2">
            {images.map((image, index) => (
              <div key={image.name} className="rounded-md border border-slate-700/80 bg-slate-900/40 p-2">
                <button
                  type="button"
                  className={`mb-2 w-full rounded px-2 py-1 text-left text-xs ${index === selectedImageIndex ? 'bg-amber-300/20 text-amber-200' : 'text-slate-300'}`}
                  onClick={() => setSelectedImageIndex(index)}
                >
                  {image.name}
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => moveImage(index, -1)}
                    className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 disabled:opacity-50"
                    disabled={index === 0}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    onClick={() => moveImage(index, 1)}
                    className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 disabled:opacity-50"
                    disabled={index === images.length - 1}
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteImage(index)}
                    className="rounded border border-rose-700 px-2 py-1 text-xs text-rose-300 hover:bg-rose-900/30"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        className={`flex shrink-0 flex-wrap items-center gap-3 border-t border-slate-700/80 px-5 py-4 ${
          tab === 'details' ? 'justify-between' : 'justify-end'
        }`}
      >
        {tab === 'details' ? (
          <button
            type="button"
            onClick={saveDetails}
            className="rounded-md border border-emerald-400/80 bg-emerald-400 px-4 py-2 text-sm font-bold uppercase tracking-wide text-slate-900 hover:bg-emerald-300"
          >
            Save details
          </button>
        ) : null}
        <button
          type="button"
          onClick={deleteTrain}
          className="rounded-md border border-rose-600/90 bg-rose-950/50 px-4 py-2 text-sm font-bold uppercase tracking-wide text-rose-200 hover:bg-rose-900/40"
        >
          Delete train
        </button>
      </div>
    </dialog>
  );
}
