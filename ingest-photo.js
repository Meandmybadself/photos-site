#!/usr/bin/env node

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, extname, basename, resolve } from 'node:path';
import { PATHS, SUPPORTED_EXTENSIONS } from './lib/config.js';
import { slugify } from './lib/inbox.js';

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { files: [], caption: '' };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') continue;
    switch (args[i]) {
      case '--caption': case '-c':
        opts.caption = args[++i] || ''; break;
      case '--help': case '-h':
        printUsage(); process.exit(0);
      default:
        if (args[i].startsWith('-')) {
          console.error(`Unknown option: ${args[i]}`);
          printUsage();
          process.exit(1);
        }
        opts.files.push(args[i]);
    }
  }
  return opts;
}

function printUsage() {
  console.log(`
Usage: node ingest-photo.js <file...> [options]

Add standalone photos to the homepage (not part of an album).

Options:
  -c, --caption <text>    Caption for the photo(s)
  -h, --help              Show this help

Examples:
  pnpm ingest-photo -- ~/Photos/sunset.jpg
  pnpm ingest-photo -- ~/Photos/sunset.jpg --caption "Sunset over the lake"
  pnpm ingest-photo -- ~/Photos/img1.jpg ~/Photos/img2.jpg
`);
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.files.length === 0) {
    console.error('Error: at least one image file is required.\n');
    printUsage();
    process.exit(1);
  }

  // Validate all files
  for (const file of opts.files) {
    const ext = extname(file).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      console.error(`Unsupported format: ${file}`);
      console.error(`Supported: ${[...SUPPORTED_EXTENSIONS].join(', ')}`);
      process.exit(1);
    }
  }

  // Read existing singles manifest to check for dupes
  let singles = [];
  try {
    singles = JSON.parse(await readFile(PATHS.singlesIndex, 'utf-8'));
  } catch { /* doesn't exist yet */ }
  const existingIds = new Set(singles.map(s => s.id));

  await mkdir(PATHS.singlesInbox, { recursive: true });

  for (const file of opts.files) {
    const absPath = resolve(file);
    const filename = basename(absPath);
    const id = slugify(filename);

    if (existingIds.has(id)) {
      console.warn(`[skip] "${filename}" (${id}) already exists in singles`);
      continue;
    }

    await copyFile(absPath, join(PATHS.singlesInbox, filename));
    if (opts.caption) {
      await writeFile(join(PATHS.singlesInbox, `${id}.json`), JSON.stringify({ caption: opts.caption }) + '\n');
    }
    console.log(`  Copied ${filename} -> inbox/_singles/`);
  }

  console.log(`\nDone! Run \`pnpm build\` to process and generate the site.`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
