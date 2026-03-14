#!/usr/bin/env node

import { readFile, writeFile, readdir, mkdir, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { PATHS } from './lib/config.js';
import { scanInbox, slugify } from './lib/inbox.js';
import { resizePhoto, cleanBuildDir } from './lib/images.js';
import { initCloudinary, uploadPhotoVariants, deletePhotoAssets, deleteAlbumAssets } from './lib/cloudinary.js';
import { generateSite, generateAlbumPages } from './lib/html.js';

// --- Manifest helpers ---

async function readGroupsIndex() {
  try {
    return JSON.parse(await readFile(PATHS.groupsIndex, 'utf-8'));
  } catch {
    return { groups: [] };
  }
}

async function writeGroupsIndex(index) {
  index.groups.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
  await mkdir(PATHS.data, { recursive: true });
  await writeFile(PATHS.groupsIndex, JSON.stringify(index, null, 2) + '\n');
}

async function readAlbumManifest(slug) {
  try {
    return JSON.parse(await readFile(join(PATHS.groups, `${slug}.json`), 'utf-8'));
  } catch {
    return null;
  }
}

async function writeAlbumManifest(manifest) {
  await mkdir(PATHS.groups, { recursive: true });
  await writeFile(join(PATHS.groups, `${manifest.slug}.json`), JSON.stringify(manifest, null, 2) + '\n');
}

async function readAllManifests() {
  let files;
  try {
    files = await readdir(PATHS.groups);
  } catch {
    return [];
  }
  const manifests = [];
  for (const f of files.filter(f => f.endsWith('.json'))) {
    manifests.push(JSON.parse(await readFile(join(PATHS.groups, f), 'utf-8')));
  }
  return manifests;
}

// --- Commands ---

async function cmdFull() {
  initCloudinary();

  const inboxGroups = await scanInbox();
  if (inboxGroups.length === 0) {
    console.log('No albums found in inbox/. Nothing to process.');
  }

  for (const group of inboxGroups) {
    const existing = await readAlbumManifest(group.slug);
    const existingIds = new Set(existing?.photos.map(p => p.id) ?? []);
    const newPhotos = group.photos.filter(p => !existingIds.has(p.id));

    if (newPhotos.length === 0) {
      console.log(`[${group.slug}] No new photos to process.`);
      continue;
    }

    console.log(`[${group.slug}] Processing ${newPhotos.length} new photo(s)...`);

    const processedPhotos = [];
    for (const photo of newPhotos) {
      try {
        console.log(`  ${photo.id}...`);
        const resized = await resizePhoto(photo.absolutePath, group.slug, photo.id, group.coverPosition);
        const uploaded = await uploadPhotoVariants(resized, group.slug, photo.id);
        processedPhotos.push({
          id: photo.id,
          originalFilename: photo.originalFilename,
          caption: photo.caption,
          order: photo.order,
          url: uploaded.full.url,
          thumbnail: uploaded.thumb.url,
          coverUrl: uploaded.cover.url,
          ...(resized.exif && { exif: resized.exif }),
        });
        console.log(`  ${photo.id} done`);
      } catch (err) {
        // Clean up any partially uploaded variants
        await deletePhotoAssets(group.slug, photo.id).catch(() => {});
        console.warn(`  [SKIP] ${photo.id}: ${err.message}`);
      }
    }

    await cleanBuildDir(group.slug);

    // Merge: existing photos keep their order, new photos append sorted by meta.yml order
    const newSorted = processedPhotos.sort((a, b) => a.order - b.order);
    const allPhotos = [...(existing?.photos ?? []), ...newSorted];
    allPhotos.forEach((p, i) => { p.order = i; });

    // Determine cover image
    const coverPhoto = group.coverPhotoId
      ? allPhotos.find(p => p.id === group.coverPhotoId)
      : allPhotos[0];

    const manifest = {
      slug: group.slug,
      title: group.title,
      description: group.description,
      dateAdded: existing?.dateAdded ?? new Date().toISOString(),
      protected: group.protected,
      coverImage: coverPhoto?.coverUrl ?? '',
      photos: allPhotos,
    };

    await writeAlbumManifest(manifest);
    console.log(`[${group.slug}] Manifest updated (${allPhotos.length} photos total).`);

    // Clean inbox for this group
    await rm(join(PATHS.inbox, group.slug), { recursive: true, force: true });
    console.log(`[${group.slug}] Inbox cleaned.`);
  }

  // Rebuild groups index from all manifests
  const allManifests = await readAllManifests();
  const groupsIndex = {
    groups: allManifests.map(m => ({
      slug: m.slug,
      title: m.title,
      description: m.description,
      dateAdded: m.dateAdded,
      coverImage: m.coverImage,
      photoCount: m.photos.length,
      protected: m.protected,
    })),
  };
  await writeGroupsIndex(groupsIndex);

  // Generate all HTML
  await generateSite(groupsIndex, allManifests);
  console.log('Site generated.');
}

async function cmdRegen() {
  const groupsIndex = await readGroupsIndex();
  const allManifests = await readAllManifests();

  // Re-sort index
  groupsIndex.groups.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));

  await generateSite(groupsIndex, allManifests);
  console.log('Site regenerated (HTML only).');
}

async function cmdDelete(slug, photoId) {
  initCloudinary();

  if (photoId) {
    // Delete a single photo
    const manifest = await readAlbumManifest(slug);
    if (!manifest) throw new Error(`Album "${slug}" not found.`);

    const photoIndex = manifest.photos.findIndex(p => p.id === photoId);
    if (photoIndex === -1) throw new Error(`Photo "${photoId}" not found in album "${slug}".`);

    console.log(`Deleting ${slug}/${photoId} from Cloudinary...`);
    await deletePhotoAssets(slug, photoId);

    manifest.photos.splice(photoIndex, 1);
    // Re-number orders
    manifest.photos.forEach((p, i) => { p.order = i; });
    // Update cover if needed
    if (manifest.photos.length > 0) {
      manifest.coverImage = manifest.photos[0].coverUrl;
    } else {
      manifest.coverImage = '';
    }
    await writeAlbumManifest(manifest);

    // Remove photo HTML directory
    await rm(join(PATHS.albums, slug, photoId), { recursive: true, force: true });

    console.log(`Photo "${photoId}" removed from "${slug}".`);
  } else {
    // Delete entire album
    const manifest = await readAlbumManifest(slug);
    if (!manifest) throw new Error(`Album "${slug}" not found.`);

    console.log(`Deleting all assets for "${slug}" from Cloudinary...`);
    const photoIds = manifest.photos.map(p => p.id);
    await deleteAlbumAssets(slug, photoIds);

    // Remove manifest file
    await unlink(join(PATHS.groups, `${slug}.json`)).catch(() => {});

    // Remove album HTML directory
    await rm(join(PATHS.albums, slug), { recursive: true, force: true });

    console.log(`Album "${slug}" deleted.`);
  }

  // Rebuild index and regenerate
  const allManifests = await readAllManifests();
  const groupsIndex = {
    groups: allManifests.map(m => ({
      slug: m.slug,
      title: m.title,
      description: m.description,
      dateAdded: m.dateAdded,
      coverImage: m.coverImage,
      photoCount: m.photos.length,
      protected: m.protected,
    })),
  };
  await writeGroupsIndex(groupsIndex);
  await generateSite(groupsIndex, allManifests);
  console.log('Site regenerated.');
}

// --- CLI ---

function parseArgs(argv) {
  const args = argv.slice(2);

  if (args.includes('--regen')) {
    return { mode: 'regen' };
  }

  const deleteIndex = args.indexOf('--delete');
  if (deleteIndex !== -1) {
    const slug = args[deleteIndex + 1];
    if (!slug) {
      console.error('Usage: node build.js --delete <slug> [photoId]');
      process.exit(1);
    }
    const photoId = args[deleteIndex + 2] || null;
    return { mode: 'delete', slug, photoId };
  }

  return { mode: 'full' };
}

async function main() {
  const { mode, slug, photoId } = parseArgs(process.argv);

  switch (mode) {
    case 'full':
      await cmdFull();
      break;
    case 'regen':
      await cmdRegen();
      break;
    case 'delete':
      await cmdDelete(slug, photoId);
      break;
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
