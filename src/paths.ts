import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (parent of `src/`). */
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const CLIENT_DIST_DIR = path.join(ROOT_DIR, 'client', 'dist');

export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
export const LAYOUT_FILE = path.join(DATA_DIR, 'layout.json');
export const ROLLING_STOCK_DIR = path.join(DATA_DIR, 'rollingstock');
export const TRAINS_DIR = path.join(ROLLING_STOCK_DIR, 'trains');
export const WAGONS_DIR = path.join(ROLLING_STOCK_DIR, 'wagons');
export const CONSISTS_DIR = path.join(DATA_DIR, 'consists');
export const AUTOMATION_DIR = path.join(DATA_DIR, 'automation');
export const LIVE_STATE_FILE = path.join(AUTOMATION_DIR, 'state.json');
export const TURNOUTS_FILE = path.join(AUTOMATION_DIR, 'turnouts.json');
export const CORRECTIONS_FILE = path.join(AUTOMATION_DIR, 'corrections.jsonl');
