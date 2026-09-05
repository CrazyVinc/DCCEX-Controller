import 'dotenv/config';
import { createApp } from './app.ts';

const PORT = Number(process.env.PORT) || 3000;
const { httpServer, shutdown } = await createApp();

httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

// Ctrl+C / kill / `node --watch` restart: halt trains, save their positions, power off, then exit.
let stopping = false;
const stop = (signal: NodeJS.Signals) => {
  if (stopping) return;
  stopping = true;
  console.log(`[${signal}] shutting down: saving train positions and switching track power off…`);
  const timeout = setTimeout(() => process.exit(1), 5000);
  shutdown()
    .catch((error) => console.error('[shutdown]', error))
    .finally(() => {
      clearTimeout(timeout);
      process.exit(0);
    });
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
