import { useCallback, useEffect, useState } from 'react';
import { AddTrainDialog } from '../components/rollingstock/AddTrainDialog.jsx';
import { EditTrainDialog } from '../components/rollingstock/EditTrainDialog.jsx';
import { RollingStockCard } from '../components/rollingstock/RollingStockCard.jsx';
import { Section } from '../components/common/Section.jsx';

export function RollingStockPage() {
  const [rollingStock, setRollingStock] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedTrain, setSelectedTrain] = useState(null);
  const [editInitialTab, setEditInitialTab] = useState('details');
  const [thumbnailsByTrain, setThumbnailsByTrain] = useState({});

  const load = useCallback(async () => {
    const stock = await fetch('/api/rolling-stock').then((r) => r.json());
    setRollingStock(stock);
    setSelectedTrain((prev) => {
      if (!prev) {
        return null;
      }
      const next = stock.trains.find((t) => String(t.DCC_ID) === String(prev.DCC_ID));
      return next ?? prev;
    });

    const imageEntries = await Promise.all(
      stock.trains.map(async (train) => {
        const response = await fetch(`/api/trains/${train.DCC_ID}/images`);
        if (!response.ok) {
          return [String(train.DCC_ID), null];
        }
        const imageData = await response.json();
        return [String(train.DCC_ID), imageData.data[0]?.url ?? null];
      }),
    );
    setThumbnailsByTrain(Object.fromEntries(imageEntries));
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
            <RollingStockCard
              key={String(train.DCC_ID)}
              train={train}
              thumbnailUrl={thumbnailsByTrain[String(train.DCC_ID)]}
              onCardClick={(clickedTrain) => {
                setSelectedTrain(clickedTrain);
                setEditInitialTab('details');
                setEditDialogOpen(true);
              }}
              onImageClick={(clickedTrain) => {
                setSelectedTrain(clickedTrain);
                setEditInitialTab('images');
                setEditDialogOpen(true);
              }}
            />
          ))}
        </div>
      </Section>

      <AddTrainDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={load} />
      <EditTrainDialog
        open={editDialogOpen}
        train={selectedTrain}
        initialTab={editInitialTab}
        onClose={() => {
          setEditDialogOpen(false);
          setSelectedTrain(null);
        }}
        onSaved={load}
      />
    </main>
  );
}
