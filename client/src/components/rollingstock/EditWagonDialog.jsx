import { useEffect, useRef, useState } from 'react';

function parseNum(raw) {
  const n = parseFloat(String(raw).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

export function EditWagonDialog({ open, wagon, initialTab = 'details', onClose, onSaved }) {
  const dialogRef = useRef(null);
  const [tab, setTab] = useState('details');
  const [formValues, setFormValues] = useState({ Name: '', Length: '' });
  const [images, setImages] = useState([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

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
    if (!open || !wagon) {
      return;
    }
    setTab(initialTab);
    setFormValues({
      Name: wagon.Name ?? '',
      Length: String(wagon.Length ?? ''),
    });
  }, [open, wagon?.id, initialTab]);

  const loadImages = async () => {
    if (!wagon) {
      return;
    }
    const response = await fetch(`/api/wagons/${wagon.id}/images`);
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    setImages(data.data);
    setSelectedImageIndex(0);
  };

  useEffect(() => {
    if (open && wagon && tab === 'images') {
      loadImages();
    }
  }, [open, wagon?.id, tab]);

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

    await fetch(`/api/wagons/${wagon.id}/images/reorder`, {
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
      await fetch(`/api/wagons/${wagon.id}/images`, {
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
    await fetch(`/api/wagons/${wagon.id}/images/${encodeURIComponent(image.name)}`, {
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
    const payload = {
      Name: formValues.Name.trim(),
      Length: parseNum(formValues.Length),
    };
    const response = await fetch(`/api/wagons/${wagon.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      await onSaved();
      onClose();
    }
  };

  const deleteWagon = async () => {
    const label = (formValues.Name || wagon.Name || '').trim() || 'Wagon';
    if (!window.confirm(`Delete wagon “${label}” permanently?`)) {
      return;
    }
    const response = await fetch(`/api/wagons/${wagon.id}`, { method: 'DELETE' });
    if (response.ok) {
      await onSaved();
      onClose();
    }
  };

  if (!wagon) {
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
        <h2 className="text-lg font-bold uppercase tracking-wider text-sky-200">Edit wagon</h2>
        <button type="button" className="m-0 p-0" aria-label="Close" onClick={() => dialogRef.current?.close()}>
          &times;
        </button>
      </div>

      <div className="flex gap-2 border-b border-slate-700/80 px-5 py-3">
        <button
          type="button"
          onClick={() => setTab('details')}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold ${tab === 'details' ? 'bg-sky-400 text-slate-900' : 'bg-slate-800 text-slate-300'}`}
        >
          Details
        </button>
        <button
          type="button"
          onClick={() => setTab('images')}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold ${tab === 'images' ? 'bg-sky-400 text-slate-900' : 'bg-slate-800 text-slate-300'}`}
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
                  value={formValues.Name}
                  onChange={(event) => setFormValues({ ...formValues, Name: event.target.value })}
                  className="rounded-md border border-slate-700/80 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs uppercase tracking-wide text-slate-400">
                Length (mm)
                <input
                  value={formValues.Length}
                  onChange={(event) => setFormValues({ ...formValues, Length: event.target.value })}
                  className="rounded-md border border-slate-700/80 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
                />
              </label>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-5 py-4 md:grid-cols-[2fr_1fr]">
          <div className="space-y-3">
            <div className="aspect-video w-full overflow-hidden rounded-lg border border-slate-700/80 bg-slate-900/40">
              {images[selectedImageIndex] ? (
                <img
                  src={images[selectedImageIndex].url}
                  alt={images[selectedImageIndex].name}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">No image selected</div>
              )}
            </div>
            <label className="inline-flex cursor-pointer rounded-md border border-sky-400/80 px-3 py-2 text-sm font-semibold text-sky-200 hover:bg-sky-400/10">
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
                  className={`mb-2 w-full rounded px-2 py-1 text-left text-xs ${index === selectedImageIndex ? 'bg-sky-400/20 text-sky-200' : 'text-slate-300'}`}
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
            className="rounded-md border border-sky-400/80 bg-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-wide text-slate-900 hover:bg-sky-400"
          >
            Save details
          </button>
        ) : null}
        <button
          type="button"
          onClick={deleteWagon}
          className="rounded-md border border-rose-600/90 bg-rose-950/50 px-4 py-2 text-sm font-bold uppercase tracking-wide text-rose-200 hover:bg-rose-900/40"
        >
          Delete wagon
        </button>
      </div>
    </dialog>
  );
}
