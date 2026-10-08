import { createApp } from './app.js';
import { closeDatabase, openDatabase, persistDatabase } from './database.js';
import { createStore } from './store.js';

const host = '127.0.0.1';
const port = Number(process.env.API_PORT ?? 4174);
const database = await openDatabase();
const store = createStore(database, { afterWrite: () => persistDatabase(database) });
const server = createApp(database, store);

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
