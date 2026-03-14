import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');

export const PATHS = {
  inbox: join(ROOT, 'inbox'),
  data: join(ROOT, 'data'),
  groups: join(ROOT, 'data', 'groups'),
  groupsIndex: join(ROOT, 'data', 'groups.json'),
  albums: join(ROOT, 'albums'),
  assets: join(ROOT, 'assets'),
  build: join(ROOT, '.build'),
};

export const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);

export const VARIANTS = {
  full: { width: 2400, quality: 85 },
  thumb: { width: 600, quality: 82 },
  cover: { width: 800, height: 600, quality: 85 },
};

export function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}
