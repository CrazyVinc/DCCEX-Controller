import { useLiveStore, type LiveLayers } from '../store/liveStore.ts';

const LAYER_LABELS: { key: keyof LiveLayers; label: string }[] = [
  { key: 'rails', label: 'Rails' },
  { key: 'trains', label: 'Trains' },
  { key: 'arrows', label: 'Direction arrows' },
  { key: 'occupancy', label: 'Occupancy' },
  { key: 'claims', label: 'Claims' },
  { key: 'turnouts', label: 'Turnout states' },
  { key: 'stations', label: 'Stations' },
  { key: 'sensors', label: 'Sensors' },
  { key: 'speeds', label: 'Speed limits' },
  { key: 'debug', label: 'Debug' },
];

export function LayerToggles() {
  const layers = useLiveStore((s) => s.layers);
  const toggleLayer = useLiveStore((s) => s.toggleLayer);
  return (
    <section className="designer-inspector-section">
      <h3>Layers</h3>
      <div className="live-layers">
        {LAYER_LABELS.map(({ key, label }) => (
          <label key={key} className="designer-check">
            <input type="checkbox" checked={layers[key]} onChange={() => toggleLayer(key)} /> {label}
          </label>
        ))}
      </div>
    </section>
  );
}
