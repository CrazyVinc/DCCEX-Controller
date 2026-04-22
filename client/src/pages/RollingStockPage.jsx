import { useCallback, useEffect, useState } from 'react';
import { AddTrainDialog } from '../components/AddTrainDialog.jsx';
import { RollingStockCard } from '../components/RollingStockCard.jsx';
import { Section } from '../components/Section.jsx';

export function RollingStockPage() {
  const [rollingStock, setRollingStock] = useState(null);
  const [globalSpeedLimit, setGlobalSpeedLimit] = useState(127);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      fetch('/api/rolling-stock').then((r) => r.json()),
      fetch('/api/settings').then((r) => r.json()),
    ]).then(([stock, settings]) => {
      setRollingStock(stock);
      setGlobalSpeedLimit(Number(settings.data.GlobalSpeedCab ?? 127));
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (rollingStock === null) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-(--muted)">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <Section
        id="trains"
        title="Trains"
        headerAction={
          <button
            type="button"
            className="rounded-lg border border-emerald-400/80 px-4 py-2 text-sm font-bold uppercase text-emerald-300 transition-colors hover:bg-emerald-400/10"
            onClick={() => setDialogOpen(true)}
          >
            + Add Train
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {rollingStock.trains.map((train) => (
            <RollingStockCard key={String(train.DCC_ID)} train={train} globalSpeedLimit={globalSpeedLimit} />
          ))}
        </div>
      </Section>

      <AddTrainDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={load} />
    </main>
  );
}
