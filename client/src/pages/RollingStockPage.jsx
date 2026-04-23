import { useCallback, useEffect, useState } from 'react';
import { AddTrainDialog } from '../components/rollingstock/AddTrainDialog.jsx';
import { AddWagonDialog } from '../components/rollingstock/AddWagonDialog.jsx';
import { EditTrainDialog } from '../components/rollingstock/EditTrainDialog.jsx';
import { EditWagonDialog } from '../components/rollingstock/EditWagonDialog.jsx';
import { RollingStockCard } from '../components/rollingstock/RollingStockCard.jsx';
import { WagonCard } from '../components/rollingstock/WagonCard.jsx';
import { Section } from '../components/common/Section.jsx';

export function RollingStockPage() {
  const [rollingStock, setRollingStock] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [wagonDialogOpen, setWagonDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editWagonDialogOpen, setEditWagonDialogOpen] = useState(false);
  const [selectedTrain, setSelectedTrain] = useState(null);
  const [selectedWagon, setSelectedWagon] = useState(null);
  const [editInitialTab, setEditInitialTab] = useState('details');
  const [editWagonInitialTab, setEditWagonInitialTab] = useState('details');
  const [thumbnailsByTrain, setThumbnailsByTrain] = useState({});
  const [thumbnailsByWagon, setThumbnailsByWagon] = useState({});

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
    setSelectedWagon((prev) => {
      if (!prev) {
        return null;
      }
      const wagons = stock.wagons ?? [];
      const next = wagons.find((w) => String(w.id) === String(prev.id));
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

    const wagons = stock.wagons ?? [];
    const wagonImageEntries = await Promise.all(
      wagons.map(async (wagon) => {
        const response = await fetch(`/api/wagons/${wagon.id}/images`);
        if (!response.ok) {
          return [String(wagon.id), null];
        }
        const imageData = await response.json();
        return [String(wagon.id), imageData.data[0]?.url ?? null];
      }),
    );
    setThumbnailsByWagon(Object.fromEntries(wagonImageEntries));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (rollingStock === null) {
    return (
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-(--muted)">Loading…</p>
      </main>
    );
  }

  const wagons = rollingStock.wagons ?? [];

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
        <Section
          id="trains"
          title="Trains"
          collapsibleBelowLg
          defaultOpenBelowLg
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
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
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

        <Section
          id="wagons"
          title="Wagons"
          titleClassName="text-sky-200"
          collapsibleBelowLg
          defaultOpenBelowLg={false}
          headerAction={
            <button
              type="button"
              className="rounded-lg border border-sky-400/80 px-4 py-2 text-sm font-bold uppercase text-sky-200 transition-colors hover:bg-sky-400/10"
              onClick={() => setWagonDialogOpen(true)}
            >
              + Add Wagon
            </button>
          }
        >
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {wagons.map((wagon) => (
              <WagonCard
                key={String(wagon.id)}
                wagon={wagon}
                thumbnailUrl={thumbnailsByWagon[String(wagon.id)]}
                onCardClick={(clicked) => {
                  setSelectedWagon(clicked);
                  setEditWagonInitialTab('details');
                  setEditWagonDialogOpen(true);
                }}
                onImageClick={(clicked) => {
                  setSelectedWagon(clicked);
                  setEditWagonInitialTab('images');
                  setEditWagonDialogOpen(true);
                }}
              />
            ))}
          </div>
        </Section>
      </div>

      <AddTrainDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={load} />
      <AddWagonDialog open={wagonDialogOpen} onClose={() => setWagonDialogOpen(false)} onSaved={load} />
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
      <EditWagonDialog
        open={editWagonDialogOpen}
        wagon={selectedWagon}
        initialTab={editWagonInitialTab}
        onClose={() => {
          setEditWagonDialogOpen(false);
          setSelectedWagon(null);
        }}
        onSaved={load}
      />
    </main>
  );
}
