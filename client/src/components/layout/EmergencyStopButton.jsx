import { useSocket } from '../../context/SocketContext.jsx';
import { Icon } from '@iconify/react';

export function EmergencyStopButton() {
  const socket = useSocket();

  return (
    <button
      type="button"
      className="sticky top-5 left-5 mt-5 z-50 inline-flex w-auto items-center gap-2 self-start rounded-full bg-red-600 px-6 py-3 text-xl font-bold uppercase tracking-wider text-white shadow-lg transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-white/80"
      onClick={() => {
        socket.emit('dcc:emergency-stop');
      }}
    >
      <Icon icon="material-symbols:warning-rounded" className="h-6 w-6 shrink-0" aria-hidden="true" />
      <span>Emergency Stop</span>
    </button>
  );
}