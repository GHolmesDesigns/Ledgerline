import { createApp } from './app.js';
import { closeDatabase, openDatabase } from './database.js';

const host = '127.0.0.1';
const port = Number(process.env.API_PORT ?? 4174);
const database = await openDatabase();
const server = createApp(database);

server.listen(port, host, () => {
  console.log(`Ledgerline API listening at http://${host}:${port}`);
});

function shutdown() {
  server.close(() => {
    closeDatabase(database);
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
