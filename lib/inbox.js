import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import yaml from 'js-yaml';
import { PATHS, SUPPORTED_EXTENSIONS } from './config.js';

export function slugify(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) throw new Error(`Cannot slugify "${filename}": results in empty string`);
  return slug;
}

export async function scanInbox() {
  let entries;
  try {
    entries = await readdir(PATHS.inbox, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries.filter(e => e.isDirectory() && e.name !== '_singles').map(e => e.name);
  const groups = [];
  for (const slug of dirs) {
    groups.push(await parseInboxGroup(slug));
  }
  return groups;
}

export async function parseInboxGroup(slug) {
  const dir = join(PATHS.inbox, slug);
  const meta = await readMeta(dir);
  const imageFiles = await findImageFiles(dir);

  const metaPhotoMap = new Map();
  if (meta.photos) {
    meta.photos.forEach((entry, i) => {
      const id = slugify(entry.file);
      metaPhotoMap.set(id, { caption: entry.caption ?? '', order: i });
    });
  }

  const photos = [];
  const seen = new Set();

  // First: photos listed in meta.yml, in order
  if (meta.photos) {
    for (const entry of meta.photos) {
      const id = slugify(entry.file);
      const match = imageFiles.find(f => slugify(basename(f)) === id);
      if (match) {
        photos.push({
          id,
          originalFilename: basename(match),
          absolutePath: match,
          caption: entry.caption ?? '',
          order: photos.length,
        });
        seen.add(id);
      }
    }
  }

  // Then: any images not in meta.yml, appended in filesystem order
  for (const filePath of imageFiles) {
    const id = slugify(basename(filePath));
    if (seen.has(id)) continue;
    // Check for slug collisions (e.g., photo.jpg and photo.png)
    const collision = photos.find(p => p.id === id);
    if (collision) {
      throw new Error(`Slug collision in "${slug}": "${basename(filePath)}" and "${collision.originalFilename}" both slugify to "${id}"`);
    }
    console.warn(`[warn] ${slug}: ${basename(filePath)} not in meta.yml, appending at end`);
    photos.push({
      id,
      originalFilename: basename(filePath),
      absolutePath: filePath,
      caption: '',
      order: photos.length,
    });
  }

  const coverPhotoId = meta.cover ? slugify(meta.cover) : (photos[0]?.id ?? null);

  return {
    slug,
    title: meta.title ?? slug,
    description: meta.description ?? '',
    protected: meta.protected ?? false,
    coverPosition: meta.cover_position ?? 'attention',
    coverPhotoId,
    photos,
  };
}

async function readMeta(dir) {
  const metaPath = join(dir, 'meta.yml');
  try {
    const content = await readFile(metaPath, 'utf-8');
    return yaml.load(content) || {};
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Missing meta.yml in ${dir}`);
    }
    throw err;
  }
}

async function findImageFiles(dir) {
  const entries = await readdir(dir);
  const images = entries
    .filter(f => SUPPORTED_EXTENSIONS.has(extname(f).toLowerCase()))
    .sort();
  return images.map(f => join(dir, f));
}
