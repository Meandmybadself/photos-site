import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PATHS, ROOT } from './config.js';

const esc = (str) =>
  String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function formatExposure(val) {
  if (!val) return null;
  if (val >= 1) return `${val}s`;
  return `1/${Math.round(1 / val)}s`;
}

function formatFocalLength(val) {
  if (!val) return null;
  return `${Math.round(val)}mm`;
}

function exifHtml(exif) {
  if (!exif) return '';

  const parts = [];

  // Camera line
  const camera = [exif.cameraMake, exif.cameraModel]
    .filter(Boolean)
    .join(' ');
  if (camera) parts.push(`<span class="exif-camera">${esc(camera)}</span>`);

  // Lens
  if (exif.lens) parts.push(`<span class="exif-lens">${esc(exif.lens)}</span>`);

  // Shooting settings
  const settings = [
    formatFocalLength(exif.focalLength),
    exif.aperture ? `f/${exif.aperture}` : null,
    formatExposure(exif.exposureTime),
    exif.iso ? `ISO ${exif.iso}` : null,
  ].filter(Boolean);
  if (settings.length) parts.push(`<span class="exif-settings">${esc(settings.join('  '))}</span>`);

  // Date taken
  if (exif.dateTaken) {
    try {
      const d = new Date(exif.dateTaken);
      const formatted = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      parts.push(`<span class="exif-date">${esc(formatted)}</span>`);
    } catch { /* skip */ }
  }

  if (parts.length === 0) return '';

  return `<div class="exif-info">\n    ${parts.join('\n    ')}\n  </div>`;
}

function layout(title, bodyContent) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
${bodyContent}
</body>
</html>
`;
}

function groupCard(group) {
  return `  <a class="group-card" href="/albums/${esc(group.slug)}/">
    <img src="${esc(group.coverImage)}" alt="${esc(group.title)}" loading="lazy" width="800" height="600">
    <div class="group-card-info">
      <h2>${esc(group.title)}</h2>
      <span class="photo-count">${group.photoCount}</span>
    </div>
  </a>`;
}

function singleCard(photo) {
  return `  <a class="group-card single-card" href="/photos/${esc(photo.id)}/">
    <img src="${esc(photo.coverUrl)}" alt="${esc(photo.caption)}" loading="lazy" width="800" height="600">
    ${photo.caption ? `<div class="group-card-info"><h2>${esc(photo.caption)}</h2></div>` : ''}
  </a>`;
}

function photoThumb(slug, photo) {
  const w = photo.thumbWidth || 600;
  const h = photo.thumbHeight || 400;
  return `  <a class="photo-thumb" href="/albums/${esc(slug)}/${esc(photo.id)}/">
    <img src="${esc(photo.thumbnail)}" alt="${esc(photo.caption)}" loading="lazy" width="${w}" height="${h}">
  </a>`;
}

export async function generateSite(groupsIndex, manifests, singles = []) {
  // Merge albums and singles into one timeline, sorted by dateAdded descending
  const items = [
    ...groupsIndex.groups.map(g => ({ type: 'album', dateAdded: g.dateAdded, data: g })),
    ...singles.map(s => ({ type: 'single', dateAdded: s.dateAdded, data: s })),
  ].sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));

  const gridCards = items.map(item =>
    item.type === 'album' ? groupCard(item.data) : singleCard(item.data)
  ).join('\n');

  const homepageBody = `<header>
  <h1><a href="/">Photos</a></h1>
</header>
<main class="group-grid">
${gridCards}
</main>`;

  const homepageHtml = layout('Photos', homepageBody);

  await writeFile(join(ROOT, 'index.html'), homepageHtml);
  await mkdir(join(PATHS.albums), { recursive: true });
  await writeFile(join(PATHS.albums, 'index.html'), homepageHtml);

  // Each album page + individual photo pages
  for (const manifest of manifests) {
    await generateAlbumPages(manifest);
  }

  // Single photo detail pages
  for (const single of singles) {
    await generateSinglePhotoPage(single);
  }

  // Write CSS
  await generateCSS();
}

export async function generateAlbumPages(manifest) {
  const albumDir = join(PATHS.albums, manifest.slug);
  await mkdir(albumDir, { recursive: true });

  // Album detail page
  const albumBody = `<header>
  <h1><a href="/">Photos</a></h1>
</header>
<main class="album">
  <div class="album-header">
    <h2>${esc(manifest.title)}</h2>
    ${manifest.description ? `<p class="album-description">${esc(manifest.description)}</p>` : ''}
  </div>
  <div class="photo-grid">
${manifest.photos.map(p => photoThumb(manifest.slug, p)).join('\n')}
  </div>
</main>`;

  await writeFile(join(albumDir, 'index.html'), layout(manifest.title, albumBody));

  // Individual photo pages
  for (let i = 0; i < manifest.photos.length; i++) {
    const photo = manifest.photos[i];
    const prev = i > 0 ? manifest.photos[i - 1] : null;
    const next = i < manifest.photos.length - 1 ? manifest.photos[i + 1] : null;
    await generatePhotoPage(manifest, photo, prev, next);
  }
}

async function generatePhotoPage(manifest, photo, prev, next) {
  const photoDir = join(PATHS.albums, manifest.slug, photo.id);
  await mkdir(photoDir, { recursive: true });

  const navPrev = prev
    ? `<a class="photo-nav photo-nav-prev" href="/albums/${esc(manifest.slug)}/${esc(prev.id)}/">&larr; Previous</a>`
    : '<span class="photo-nav"></span>';
  const navNext = next
    ? `<a class="photo-nav photo-nav-next" href="/albums/${esc(manifest.slug)}/${esc(next.id)}/">Next &rarr;</a>`
    : '<span class="photo-nav"></span>';

  const body = `<header>
  <h1><a href="/">Photos</a></h1>
</header>
<main class="photo-detail">
  <nav class="breadcrumb">
    <a href="/albums/${esc(manifest.slug)}/">${esc(manifest.title)}</a>
  </nav>
  <figure>
    <img src="${esc(photo.url)}" alt="${esc(photo.caption)}" loading="eager">
    ${photo.caption ? `<figcaption>${esc(photo.caption)}</figcaption>` : ''}
  </figure>
  ${exifHtml(photo.exif)}
  <nav class="photo-pagination">
    ${navPrev}
    ${navNext}
  </nav>
</main>`;

  await writeFile(join(photoDir, 'index.html'), layout(`${photo.caption || photo.id} - ${manifest.title}`, body));
}

async function generateSinglePhotoPage(photo) {
  const photoDir = join(PATHS.photos, photo.id);
  await mkdir(photoDir, { recursive: true });

  const body = `<header>
  <h1><a href="/">Photos</a></h1>
</header>
<main class="photo-detail">
  <nav class="breadcrumb">
    <a href="/">Home</a>
  </nav>
  <figure>
    <img src="${esc(photo.url)}" alt="${esc(photo.caption)}" loading="eager">
    ${photo.caption ? `<figcaption>${esc(photo.caption)}</figcaption>` : ''}
  </figure>
  ${exifHtml(photo.exif)}
</main>`;

  await writeFile(join(photoDir, 'index.html'), layout(photo.caption || photo.id, body));
}

async function generateCSS() {
  const css = `*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: #1a1a1a;
  background: #ddd1d1;
  line-height: 1.5;
}

a {
  color: inherit;
  text-decoration: none;
}

header {
  padding: 1rem 2rem 1rem;
}

header h1 {
  font-size: 1.625rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

header h1 a:hover {
  opacity: 0.6;
}

/* Homepage / Albums index — group grid */
.group-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  grid-auto-rows: 1fr;
  gap: 0.75rem;
  padding: 0 2rem 3rem;
}

.group-card {
  display: flex;
  flex-direction: column;
  border-radius: 0;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

.single-card:not(:has(.group-card-info)) {
  background: transparent;
  box-shadow: none;
}

.group-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
}

.group-card img {
  width: 100%;
  flex: 1;
  display: block;
  aspect-ratio: 4/3;
  object-fit: cover;
}

.group-card-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.45rem 0.6rem;
}

.group-card-info h2 {
  font-size: 0.8rem;
  font-weight: 600;
}

.photo-count {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.2rem;
  height: 1.2rem;
  background: #666;
  color: #fff;
  font-size: 0.525rem;
  font-weight: 600;
  flex-shrink: 0;
}

/* Album detail */
.album {
  padding: 0 2rem 3rem;
}

.album-header {
  margin-bottom: 1.5rem;
}

.album-header h2 {
  font-size: 1.5rem;
  font-weight: 600;
}

.album-description {
  color: #555;
  margin-top: 0.25rem;
}

.photo-grid {
  columns: 3 280px;
  column-gap: 0.75rem;
}

.photo-thumb {
  display: block;
  break-inside: avoid;
  margin-bottom: 0.75rem;
  overflow: hidden;
}

.photo-thumb img {
  width: 100%;
  height: auto;
  display: block;
}

/* Individual photo page */
.photo-detail {
  padding: 0 2rem 3rem;
  max-width: 1200px;
  margin: 0 auto;
}

.breadcrumb {
  margin-bottom: 1rem;
  font-size: 0.9rem;
}

.breadcrumb a {
  color: #555;
}

.breadcrumb a:hover {
  color: #1a1a1a;
}

figure {
  margin-bottom: 1rem;
}

figure img {
  width: 100%;
  height: auto;
  max-height: calc(100vh - 10rem);
  object-fit: contain;
  display: block;
}

figcaption {
  margin-top: 0.5rem;
  font-size: 0.95rem;
  color: #444;
}

.photo-pagination {
  display: flex;
  justify-content: space-between;
  padding-top: 1rem;
}

.photo-nav {
  font-size: 0.9rem;
  color: #555;
  min-width: 80px;
}

.photo-nav:hover {
  color: #1a1a1a;
}

.photo-nav-next {
  text-align: right;
}

/* EXIF metadata */
.exif-info {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.25rem;
  font-size: 0.8rem;
  color: #888;
  margin-bottom: 1rem;
}

@media (max-width: 640px) {
  header { padding: 1.25rem 1rem 0.75rem; }
  .group-grid { padding: 0 1rem 2rem; gap: 1rem; grid-template-columns: 1fr; }
  .album { padding: 0 1rem 2rem; }
  .photo-grid { columns: 2 150px; column-gap: 0.5rem; }
  .photo-detail { padding: 0 1rem 2rem; }
}
`;

  await mkdir(PATHS.assets, { recursive: true });
  await writeFile(join(PATHS.assets, 'style.css'), css);
}
