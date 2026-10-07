// Thin RentCast HTTP wrapper. It sends one request per call and never retries, because every request counts toward the cap.
const BASE_URL = 'https://api.rentcast.io/v1';

export const ENDPOINTS = {
  sale: '/listings/sale',
  rental: '/listings/rental/long-term',
  'rent-estimate': '/avm/rent/long-term',
};

export function createClient({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
  return {
    // Resolves with { status, body } for any HTTP response; rejects only when there is no response at all.
    async get(kind, params) {
      const url = new URL(BASE_URL + ENDPOINTS[kind]);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
      // The key travels in a header only, so URLs are safe to log.
      const res = await fetchImpl(url, {
        headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let body = text;
      try { body = JSON.parse(text); } catch { /* keep the text */ }
      return { status: res.status, body };
    },
  };
}

// A short, key-free reason for a failed response.
export function errorMessage(res) {
  const detail = typeof res.body === 'string' ? res.body : res.body?.message ?? res.body?.error ?? '';
  return `HTTP ${res.status}${detail ? ': ' + String(detail).slice(0, 200) : ''}`;
}
