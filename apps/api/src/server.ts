import { createApp } from './app.js';
import { MockListingProvider } from './providers/mock-provider.js';
import { RefreshJob, startRefreshScheduler } from './providers/refresh-job.js';
import { closeDatabase, openDatabase, persistDatabase } from './database.js';
import { createStore } from './store.js';
import { ProviderCredentials } from './provider-credentials.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const host = '127.0.0.1';
const port = Number(process.env.API_PORT ?? 4174);
const database = await openDatabase();
const store = createStore(database, { afterWrite: () => persistDatabase(database) });
const provider = new MockListingProvider();
const credentials = new ProviderCredentials(
  resolve(dirname(fileURLToPath(import.meta.url)), '../.env'),
);
const refreshJob = new RefreshJob(store, provider, undefined, () => credentials.getRentCastKey());
const stopRefreshScheduler = startRefreshScheduler(refreshJob);
const server = createApp(database, store, refreshJob, credentials);

server.listen(port, host, () => {
  console.log(`Ledgerline API listening at http://${host}:${port}`);
});

function shutdown() {
  stopRefreshScheduler();
  server.close(() => {
    closeDatabase(database);
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
