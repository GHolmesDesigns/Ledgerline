export const SETTINGS_ORDER_KEY = 'ledgerline.settings-section-order';

export const defaultSettingsSectionIds = [
  'appearance',
  'ranking-weights',
  'assumptions',
  'saved-searches',
  'personal-tags',
  'rentcast-usage',
  'keys',
  'property-match-review',
  'backup-restore',
  'about',
] as const;

export type SettingsSectionId = (typeof defaultSettingsSectionIds)[number];

export function mergeSettingsOrder<T extends string>(
  defaults: readonly T[],
  saved: readonly string[],
) {
  const known = new Set<string>(defaults);
  const result = saved.filter((id, index) => known.has(id) && saved.indexOf(id) === index) as T[];
  defaults.forEach((id, index) => {
    if (result.includes(id)) return;
    const previous = defaults
      .slice(0, index)
      .reverse()
      .find((candidate) => result.includes(candidate));
    const next = defaults.slice(index + 1).find((candidate) => result.includes(candidate));
    if (previous) result.splice(result.indexOf(previous) + 1, 0, id);
    else if (next) result.splice(result.indexOf(next), 0, id);
    else result.push(id);
  });
  return result;
}

export function moveSettingsSection<T>(order: readonly T[], from: number, to: number) {
  if (from < 0 || from >= order.length || to < 0 || to >= order.length || from === to)
    return [...order];
  const result = [...order];
  const [item] = result.splice(from, 1);
  if (item !== undefined) result.splice(to, 0, item);
  return result;
}

export function readSettingsOrder(): SettingsSectionId[] {
  try {
    const stored = window.localStorage.getItem(SETTINGS_ORDER_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return mergeSettingsOrder(
      defaultSettingsSectionIds,
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [],
    );
  } catch {
    return [...defaultSettingsSectionIds];
  }
}
