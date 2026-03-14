#!/usr/bin/env node

import { readdir, copyFile, mkdir, stat } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { join, extname, basename, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import yaml from 'js-yaml';
import { PATHS, SUPPORTED_EXTENSIONS } from './lib/config.js';
import { slugify } from './lib/inbox.js';

// --- Interactive prompts ---

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question, defaultVal) {
  const suffix = defaultVal ? ` (${defaultVal})` : '';
  return new Promise(r => {
    rl.question(`${question}${suffix}: `, answer => {
      r(answer.trim() || defaultVal || '');
    });
  });
}

function confirm(question) {
  return new Promise(r => {
    rl.question(`${question} [Y/n]: `, answer => {
      r(answer.trim().toLowerCase() !== 'n');
    });
  });
}

// --- CLI arg parsing ---

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { sourceDir: null, title: null, slug: null, protected: false, description: null };

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') continue;
    switch (args[i]) {
      case '--title': case '--name': case '-t':
        opts.title = args[++i]; break;
      case '--slug': case '-s':
        opts.slug = args[++i]; break;
      case '--protected': case '-p':
        opts.protected = true; break;
      case '--description': case '-d':
        opts.description = args[++i]; break;
      case '--help': case '-h':
        printUsage(); process.exit(0);
      default:
        if (args[i].startsWith('-')) {
          console.error(`Unknown option: ${args[i]}`);
          printUsage();
          process.exit(1);
        }
        positional.push(args[i]);
    }
  }

  opts.sourceDir = positional[0] || null;
  return opts;
}

function printUsage() {
  console.log(`
Usage: node import.js <source-directory> [options]

Options:
  -t, --title <title>         Album title
  -s, --slug <slug>           Album slug (derived from title if omitted)
  -d, --description <desc>    Album description
  -p, --protected             Mark album as protected
  -h, --help                  Show this help

Examples:
  pnpm import -- ~/Photos/vacation
  pnpm import -- ~/Photos/vacation --title "Summer Vacation" --protected
  pnpm import -- ~/Photos/vacation -t "BWCA 2026" -d "Boundary Waters trip"
`);
}

// --- Core logic ---

async function findImages(dir) {
  const entries = await readdir(dir);
  return entries
    .filter(f => SUPPORTED_EXTENSIONS.has(extname(f).toLowerCase()))
    .sort();
}

function slugifyTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main() {
  const opts = parseArgs(process.argv);

  // Source directory
  if (!opts.sourceDir) {
    console.error('Error: source directory is required.\n');
    printUsage();
    process.exit(1);
  }

  const sourceDir = resolve(opts.sourceDir);
  try {
    const s = await stat(sourceDir);
    if (!s.isDirectory()) throw new Error();
  } catch {
    console.error(`Error: "${sourceDir}" is not a directory.`);
    process.exit(1);
  }

  // Find images
  const imageFiles = await findImages(sourceDir);
  if (imageFiles.length === 0) {
    console.error(`No supported images found in "${sourceDir}".`);
    console.error(`Supported formats: ${[...SUPPORTED_EXTENSIONS].join(', ')}`);
    process.exit(1);
  }

  console.log(`Found ${imageFiles.length} image(s) in ${sourceDir}\n`);

  // Title
  const title = opts.title || await ask('Album title', basename(sourceDir));

  // Slug — derived automatically from title
  const slug = opts.slug || slugifyTitle(title);

  // Check for existing album
  try {
    await stat(join(PATHS.inbox, slug));
    console.warn(`\nWarning: inbox/${slug}/ already exists. New photos will be merged.`);
    if (!await confirm('Continue?')) {
      console.log('Aborted.');
      process.exit(0);
    }
  } catch { /* doesn't exist, good */ }

  // Description
  const description = opts.description ?? await ask('Description (optional)', '');

  // Protected — use flag if passed, otherwise ask interactively
  let protectedFlag = opts.protected;
  if (!protectedFlag) {
    protectedFlag = (await ask('Protected? (y/N)', 'n')).toLowerCase() === 'y';
  }

  const photos = imageFiles.map(file => ({ file, caption: '' }));

  // Build meta.yml
  const meta = {
    title,
    description: description || undefined,
    cover: imageFiles[0],
    protected: protectedFlag || undefined,
    photos: photos.map(p => ({
      file: p.file,
      caption: p.caption || '',
    })),
  };

  // Preview
  const metaYaml = yaml.dump(meta, { lineWidth: -1, quotingType: '"', forceQuotes: false });
  console.log(`\n--- meta.yml ---`);
  console.log(metaYaml);
  console.log(`Images will be copied to: inbox/${slug}/`);

  if (!await confirm('\nProceed?')) {
    console.log('Aborted.');
    rl.close();
    process.exit(0);
  }

  // Copy files and write meta.yml
  const destDir = join(PATHS.inbox, slug);
  await mkdir(destDir, { recursive: true });

  for (const file of imageFiles) {
    await copyFile(join(sourceDir, file), join(destDir, file));
    console.log(`  Copied ${file}`);
  }

  await writeFile(join(destDir, 'meta.yml'), metaYaml);
  console.log(`  Wrote meta.yml`);

  console.log(`\nDone! Run \`pnpm build\` to process and generate the site.`);
  rl.close();
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
