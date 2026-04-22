import { useEffect, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

const ON_ACTIVE =
  'border-emerald-300 bg-emerald-400 text-slate-900 hover:bg-emerald-300';
const ON_IDLE =
  'border-emerald-400/80 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/40';
const OFF_ACTIVE =
  'border-rose-400/80 bg-rose-500 text-slate-900 hover:bg-rose-400';
const OFF_IDLE =
  'border-rose-500 bg-rose-950/20 text-rose-500 hover:bg-rose-950/40';

export function PowerPanel() {
  const socket = useSocket();
  const [power, setPower] = useState(false);

  useEffect(() => {
    const onPower = (payload) => setPower(payload.power);
    const onStatus = (payload) => setPower(payload.power);

    socket.on('dcc:power', onPower);
    socket.on('dcc:status', onStatus);
    socket.emit('dcc:status');

    return () => {
      socket.off('dcc:power', onPower);
      socket.off('dcc:status', onStatus);
    };
  }, [socket]);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <button
        id="dcc-power-on"
        type="button"
        className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-4 text-sm font-semibold uppercase tracking-wide transition ${power ? ON_ACTIVE : ON_IDLE}`}
        onClick={() => socket.emit('dcc:power:on')}
      >
        <span aria-hidden="true">{'\u26A1'}</span>
        <span>Power On</span>
      </button>
      <button
        id="dcc-power-off"
        type="button"
        className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-4 text-sm font-semibold uppercase tracking-wide transition ${power ? OFF_IDLE : OFF_ACTIVE}`}
        onClick={() => socket.emit('dcc:power:off')}
      >
        <span aria-hidden="true">○</span>
        <span>Power Off</span>
      </button>
    </div>
  );
}
