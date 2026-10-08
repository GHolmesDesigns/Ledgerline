import type { Database } from 'sql.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export function createApp(database: Database) {
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method === 'GET' && request.url === '/api/health') {
      let databaseReady = true;
      try {
        database.exec('SELECT 1');
      } catch {
        databaseReady = false;
      }
      response.writeHead(databaseReady ? 200 : 503, {
        'content-type': 'application/json; charset=utf-8',
      });
      response.end(JSON.stringify({ status: databaseReady ? 'ok' : 'unavailable' }));
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Not found' }));
  });
}
