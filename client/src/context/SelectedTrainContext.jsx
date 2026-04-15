import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'selectedTrain';

export const SelectedTrainContext = createContext(null);

export function SelectedTrainProvider({ trains, children }) {
  const [selectedCab, setSelectedCabState] = useState(() => localStorage.getItem(STORAGE_KEY));

  const setSelectedCab = useCallback((cab) => {
    const v = cab == null ? null : String(cab);
    setSelectedCabState(v);
    if (v) {
      localStorage.setItem(STORAGE_KEY, v);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (trains.length === 0) {
      setSelectedCab(null);
      return;
    }
    const ids = trains.map((t) => String(t.DCC_ID));
    if (selectedCab && ids.includes(String(selectedCab))) {
      return;
    }
    setSelectedCab(trains[0].DCC_ID);
  }, [trains, selectedCab, setSelectedCab]);

  const value = useMemo(
    () => ({ selectedCab, setSelectedCab }),
    [selectedCab, setSelectedCab],
  );

  return (
    <SelectedTrainContext.Provider value={value}>{children}</SelectedTrainContext.Provider>
  );
}

export function useSelectedTrain() {
  const ctx = useContext(SelectedTrainContext);
  if (!ctx) {
    throw new Error('useSelectedTrain must be used within SelectedTrainProvider');
  }
  return ctx;
}
