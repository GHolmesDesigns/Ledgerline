import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const keyLine = /^\s*RENTCAST_API_KEY\s*=\s*(.*?)\s*$/;
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

  getRentCastKey(): string | null {
    if (!existsSync(this.filePath)) return null;
    const value = readFileSync(this.filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(keyLine)?.[1])
      .find((entry) => entry !== undefined);
    const key = value === undefined ? '' : decodeValue(value).trim();
    return key || null;
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

  setRentCastKey(value: unknown) {
    if (typeof value !== 'string' || value.trim().length === 0 || /[\r\n]/.test(value)) {
      throw new Error('Enter a valid RentCast API key.');
    }
    const key = value.trim();
    const lines = existsSync(this.filePath)
      ? readFileSync(this.filePath, 'utf8').split(/\r?\n/)
      : [];
    const retained = lines.filter((line) => !keyLine.test(line));
    while (retained.at(-1) === '') retained.pop();
    retained.push(`RENTCAST_API_KEY=${JSON.stringify(key)}`);
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${retained.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryPath, this.filePath);
  }
}

export function redactCredential(message: string, credential: string | null) {
  return credential ? message.split(credential).join('[REDACTED]') : message;
}
