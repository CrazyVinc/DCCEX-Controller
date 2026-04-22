import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FunctionButtons } from '../components/cab/FunctionButtons.jsx';
import { PowerPanel } from '../components/cab/PowerPanel.jsx';
import { Section } from '../components/common/Section.jsx';
import { SelectedTrainProvider, useSelectedTrain } from '../context/SelectedTrainContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { SpeedControls } from '../components/cab/SpeedControls.jsx';
import { TrainPicker } from '../components/cab/TrainPicker.jsx';

function ControllerBody({ trains, globalSpeedLimit }) {
  const { selectedCab, setSelectedCab } = useSelectedTrain();
  const speedRef = useRef(null);
  const [meter, setMeter] = useState('0');
  const socket = useSocket();
  const [testOut, setTestOut] = useState('');

  useEffect(() => {
    const onMsg = ({ message }) => setTestOut(message);
    socket.on('dcc:message', onMsg);
    return () => socket.off('dcc:message', onMsg);
  }, [socket]);

  const selectedTrain = trains.find((train) => String(train.DCC_ID) === String(selectedCab));
  const selectedTrainLimit = Number(selectedTrain?.Speed?.limit ?? globalSpeedLimit);
  const effectiveSpeedLimit = Math.min(globalSpeedLimit, selectedTrainLimit);

  return (
    <>
      <Section id="power" title="Power">
        <PowerPanel />
      </Section>

      <Section id="controller" title="Controls" className="mt-5">

        <div className="train-controller-row flex flex-row items-start gap-4">
          <TrainPicker trains={trains} selectedCab={selectedCab} onSelect={setSelectedCab} />
          <div className="flex flex-1 flex-row justify-end">
            <div className="inline-flex cursor-pointer items-center overflow-hidden rounded-md border border-slate-700 bg-slate-800 text-sm shadow-sm transition-colors hover:border-slate-500">
              <span className="px-4 py-2 font-semibold text-slate-100" id="speedometer">
                {meter}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-row items-start gap-3 md:gap-8">
          <div className="min-w-0 flex-1 md:w-1/2 [&>div]:!flex-nowrap [&>div]:overflow-x-auto max-md:[&>div]:!justify-start">
            <SpeedControls ref={speedRef} onMeterChange={setMeter} maxSpeed={effectiveSpeedLimit} />
          </div>
          <div className="w-auto shrink-0 md:w-1/2 md:min-w-0 md:shrink">
            <FunctionButtons trains={trains} size="lg" layout="portrait" />
          </div>
        </div>

        <button
          id="dcc-stop"
          type="button"
          className="mt-5 w-full cursor-pointer rounded-full border-0 bg-linear-to-r from-[#F43F5E] to-[#E11D48] py-2.5 font-sans text-xl font-bold uppercase tracking-wide text-slate-50 shadow-[0_0_24px_rgba(244,63,94,0.42),0_4px_14px_rgba(15,23,42,0.35)] transition-[box-shadow,transform] duration-300 hover:shadow-[0_0_32px_rgba(244,63,94,0.5),0_4px_14px_rgba(15,23,42,0.4)] active:translate-y-px active:shadow-[0_0_18px_rgba(244,63,94,0.35),0_2px_8px_rgba(15,23,42,0.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300/50 sm:py-3 sm:text-2xl"
          onClick={() => speedRef.current?.emergencyStop()}
        >
          stop
        </button>
      </Section>

      <Section id="test" title="Test" className="mt-5">
        <TestPanel socket={socket} output={testOut} setOutput={setTestOut} />
      </Section>
    </>
  );
}

function TestPanel({ socket, output, setOutput }) {
  const [cmd, setCmd] = useState('');

  const send = () => {
    const command = cmd.trim();
    if (!command) {
      return;
    }
    setOutput('Sending...');
    socket.emit('dcc:send', command);
  };

  return (
    <div className="flex max-w-sm flex-col gap-3">
      <input
        type="text"
        value={cmd}
        onChange={(e) => setCmd(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && send()}
        className="rounded border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder="Type DCC command..."
      />
      <button
        type="button"
        className="rounded bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 active:bg-blue-800"
        onClick={send}
      >
        Submit
      </button>
      <div className="font-medium text-slate-200">{output}</div>
    </div>
  );
}

export function HomePage() {
  const location = useLocation();
  const [trains, setTrains] = useState(null);
  const [globalSpeedLimit, setGlobalSpeedLimit] = useState(126);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [stockRes, settingsRes] = await Promise.all([
        fetch('/api/rolling-stock'),
        fetch('/api/settings'),
      ]);
      if (cancelled) {
        return;
      }
      const stock = await stockRes.json();
      const settings = await settingsRes.json();
      setTrains(stock.trains);
      setGlobalSpeedLimit(Number(settings.data.GlobalSpeedCab ?? 126));
    })();
    return () => {
      cancelled = true;
    };
  }, [location.key]);

  if (trains === null) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-(--muted)">Loading…</p>
      </main>
    );
  }

  if (trains.length === 0) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <section className="rounded-2xl border border-slate-700/80 bg-[#121a2f] p-6 shadow-[0_0_24px_rgba(56,189,248,0.1)]">
          <p className="text-slate-200">No trains configured yet.</p>
          <p className="mt-2 text-sm text-(--muted)">
            Add locos in{' '}
            <Link className="font-medium text-amber-300 underline hover:text-amber-200" to="/rollingstock">
              Rolling Stock
            </Link>
            .
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <SelectedTrainProvider trains={trains}>
        <ControllerBody trains={trains} globalSpeedLimit={globalSpeedLimit} />
      </SelectedTrainProvider>
    </main>
  );
}
