import { useCallback, useEffect, useState } from 'react';
import { AddTrainDialog } from '../components/AddTrainDialog.jsx';
import { RollingStockCard } from '../components/RollingStockCard.jsx';

export function RollingStockPage() {
  const [rollingStock, setRollingStock] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(() => {
    fetch('/api/rolling-stock')
      .then((r) => r.json())
      .then(setRollingStock);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (rollingStock === null) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-[var(--muted)]">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <section id="trains">
        <div className="mx-auto max-w-6xl rounded-xl border border-[#30363d] bg-[#161b22] p-6 shadow-2xl">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-2xl font-bold uppercase tracking-wider text-[#ff9d00]">Trains</h1>
            <div className="flex gap-3">
              <button
                type="button"
                className="rounded-lg border border-[#00c896] px-4 py-2 text-sm font-bold uppercase text-[#00c896] transition-colors hover:bg-[#00c8961a]"
                onClick={() => setDialogOpen(true)}
              >
                + Add Train
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {rollingStock.trains.map((train) => (
              <RollingStockCard key={String(train.DCC_ID)} train={train} />
            ))}
          </div>
        </div>
      </section>

      <AddTrainDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={load} />
    </main>
  );
}
