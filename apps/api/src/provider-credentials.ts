import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const keyLine = /^\s*RENTCAST_API_KEY\s*=\s*(.*?)\s*$/;
const mapsKeyLine = /^\s*GOOGLE_MAPS_API_KEY\s*=\s*(.*?)\s*$/;
const providerLine = /^\s*LISTING_PROVIDER\s*=\s*(.*?)\s*$/;

export type ListingProviderChoice = 'mock' | 'rentcast';

function decodeValue(value: string) {
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'string' ? parsed : '';
    } catch {
      return '';
    }
  }
  return value;
}

/** Reads and writes provider credentials in a local, git-ignored API config file. */
export class ProviderCredentials {
  constructor(private readonly filePath: string) {}

  private readKey(pattern: RegExp): string | null {
    if (!existsSync(this.filePath)) return null;
    const value = readFileSync(this.filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(pattern)?.[1])
      .find((entry) => entry !== undefined);
    const key = value === undefined ? '' : decodeValue(value).trim();
    return key || null;
  }

  getRentCastKey(): string | null {
    return this.readKey(keyLine);
  }

  getGoogleMapsKey(): string | null {
    return this.readKey(mapsKeyLine);
  }

  isGoogleMapsConfigured() {
    return this.getGoogleMapsKey() !== null;
  }

  isRentCastConfigured() {
    return this.getRentCastKey() !== null;
  }

  getListingProvider(): ListingProviderChoice {
    if (!existsSync(this.filePath)) return 'mock';
    const value = readFileSync(this.filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(providerLine)?.[1])
      .find((entry) => entry !== undefined);
    const choice = value === undefined ? '' : decodeValue(value).trim().toLocaleLowerCase('en-US');
    if (!choice) return 'mock';
    if (choice === 'mock' || choice === 'rentcast') return choice;
    throw new Error('LISTING_PROVIDER must be either mock or rentcast.');
  }

  setListingProvider(value: unknown) {
    if (value !== 'mock' && value !== 'rentcast') {
      throw new Error('LISTING_PROVIDER must be either mock or rentcast.');
    }
    const lines = existsSync(this.filePath)
      ? readFileSync(this.filePath, 'utf8').split(/\r?\n/)
      : [];
    const retained = lines.filter((line) => !providerLine.test(line));
    while (retained.at(-1) === '') retained.pop();
    retained.push(`LISTING_PROVIDER=${value}`);
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${retained.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryPath, this.filePath);
  }

  private writeKey(value: unknown, pattern: RegExp, name: string, label: string) {
    if (typeof value !== 'string' || value.trim().length === 0 || /[\r\n]/.test(value)) {
      throw new Error(`Enter a valid ${label} key.`);
    }
    const key = value.trim();
    const lines = existsSync(this.filePath)
      ? readFileSync(this.filePath, 'utf8').split(/\r?\n/)
      : [];
    const retained = lines.filter((line) => !pattern.test(line));
    while (retained.at(-1) === '') retained.pop();
    retained.push(`${name}=${JSON.stringify(key)}`);
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${retained.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryPath, this.filePath);
  }

  setRentCastKey(value: unknown) {
    this.writeKey(value, keyLine, 'RENTCAST_API_KEY', 'RentCast API');
  }

  setGoogleMapsKey(value: unknown) {
    this.writeKey(value, mapsKeyLine, 'GOOGLE_MAPS_API_KEY', 'Google Maps API');
  }
}

export function redactCredential(message: string, credential: string | null) {
  return credential ? message.split(credential).join('[REDACTED]') : message;
}
