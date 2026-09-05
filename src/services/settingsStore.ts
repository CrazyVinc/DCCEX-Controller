import { readFile, writeFile } from 'node:fs/promises';
import { SettingsSchema, type Settings } from '../../shared/src/schemas/settings.ts';
import { SETTINGS_FILE } from '../paths.ts';

export async function readSettings(): Promise<Settings> {
  const text = await readFile(SETTINGS_FILE, 'utf-8');
  return SettingsSchema.parse(JSON.parse(text));
}

export async function writeSettings(settings: Settings): Promise<void> {
  await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}
