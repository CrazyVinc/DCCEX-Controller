import fs from 'node:fs';
import { DEFAULT_SETTINGS } from '../../shared/src/schemas/settings.ts';
import { AUTOMATION_DIR, CONSISTS_DIR, SETTINGS_FILE, TRAINS_DIR, WAGONS_DIR } from '../paths.ts';

/**
 * Startup bootstrap: make sure the `data/` tree and a default settings file exist.
 * Runs once before the server accepts requests, so synchronous fs calls are fine here.
 */
export function bootstrapDataDirs(): void {
  for (const dir of [TRAINS_DIR, WAGONS_DIR, CONSISTS_DIR, AUTOMATION_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  }
}
