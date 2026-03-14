#!/usr/bin/env node

import { watch } from 'node:fs';
import { readdir, mkdir, copyFile, rename, stat } from 'node:fs/promises';
import { join, extname, basename, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { PATHS, SUPPORTED_EXTENSIONS } from './lib/config.js';
import { slugify } from './lib/inbox.js';

const args = process.argv.slice(2).filter(a => a !== '--');
const watchDir = resolve(args[0] || '.');
const processedDir = join(watchDir, 'processed');

let processing = false;
const queue = [];

async function processFile(filePath) {
  const filename = basename(filePath);
  const id = slugify(filename);

  console.log(`[watch] Processing ${filename}...`);

  // Copy to singles inbox
  await mkdir(PATHS.singlesInbox, { recursive: true });
  await copyFile(filePath, join(PATHS.singlesInbox, filename));

  // Run build
  try {
    execSync('pnpm build', { cwd: PATHS.inbox.replace('/inbox', ''), stdio: 'inherit' });
  } catch (err) {
    console.error(`[watch] Build failed for ${filename}: ${err.message}`);
    return;
  }

  // Move to processed
  await mkdir(processedDir, { recursive: true });
  await rename(filePath, join(processedDir, filename));
  console.log(`[watch] ${filename} done -> processed/`);
}

async function drainQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const filePath = queue.shift();
    try {
      await processFile(filePath);
    } catch (err) {
      console.error(`[watch] Error: ${err.message}`);
    }
  }

  processing = false;
}

function enqueue(filePath) {
  if (!queue.includes(filePath)) {
    queue.push(filePath);
    drainQueue();
  }
}

// Process any existing images on startup
async function processExisting() {
  let entries;
  try {
    entries = await readdir(watchDir);
  } catch {
    return;
  }
  for (const f of entries.sort()) {
    if (SUPPORTED_EXTENSIONS.has(extname(f).toLowerCase())) {
      enqueue(join(watchDir, f));
    }
  }
}

// Debounce map to wait for file writes to complete
const pending = new Map();

watch(watchDir, (eventType, filename) => {
  if (!filename) return;
  if (!SUPPORTED_EXTENSIONS.has(extname(filename).toLowerCase())) return;

  const filePath = join(watchDir, filename);

  // Debounce — wait for file to finish writing
  if (pending.has(filename)) clearTimeout(pending.get(filename));
  pending.set(filename, setTimeout(async () => {
    pending.delete(filename);
    try {
      const s = await stat(filePath);
      if (s.isFile() && s.size > 0) {
        enqueue(filePath);
      }
    } catch {
      // File may have been moved/deleted
    }
  }, 1000));
});

console.log(`[watch] Watching ${watchDir} for new images...`);
console.log(`[watch] Processed images will be moved to ${processedDir}`);
console.log(`[watch] Press Ctrl+C to stop.\n`);

await processExisting();
