import 'dotenv/config';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 3000;
const { httpServer } = createApp();

httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
