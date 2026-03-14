# Photo Site

A static, self-hosted photo sharing site. Drop photos into a folder, run the build tool, push — done.

Images are resized locally with [sharp](https://sharp.pixelplumbing.com/), uploaded to [Cloudinary](https://cloudinary.com/) for CDN delivery, and all HTML is pre-generated as static files for [GitHub Pages](https://pages.github.com/).

## Requirements

- Node.js 22+
- [pnpm](https://pnpm.io/)
- A [Cloudinary](https://cloudinary.com/) account (free tier)

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in your Cloudinary credentials in .env
```

## Usage

### Import photos

```bash
pnpm ingest -- ~/Photos/my-trip --name "My Trip"
pnpm ingest -- ~/Photos/my-trip --name "My Trip" --description "A week in Iceland" --protected
```

This copies images into `inbox/<slug>/`, generates a `meta.yml`, and prepares everything for the build step. The slug is derived from the title automatically.

### Build the site

```bash
pnpm build          # Full build: process inbox, upload to Cloudinary, generate HTML
pnpm regen          # Regenerate HTML only (no Cloudinary changes)
```

### Delete content

```bash
node --env-file=.env build.js --delete my-trip          # Delete an entire album
node --env-file=.env build.js --delete my-trip img-001   # Delete a single photo
```

### Add photos to an existing album

1. Drop new images into `inbox/<slug>/`
2. Update `inbox/<slug>/meta.yml` to include the new files
3. Run `pnpm build`

The build tool detects existing albums and only processes new photos.

### Edit metadata

Edit `data/groups/<slug>.json` directly (title, description, captions, photo order), then run `pnpm regen`.

## How it works

```
inbox/<slug>/        Source photos + meta.yml
       |
   pnpm build        Resize (sharp) -> Upload (Cloudinary) -> Generate HTML
       |
  index.html         Static site ready for GitHub Pages
  albums/<slug>/
  data/groups/
```

### Image variants

All images are converted to WebP:

| Variant | Size | Usage |
|---|---|---|
| Full | 2400px wide | Individual photo page |
| Thumbnail | 600px wide | Album grid |
| Cover | 800x600 cropped | Album card on homepage |

### EXIF metadata

Camera info, shooting settings, and date taken are extracted from source images and displayed on individual photo pages.

### Site structure

```
/                           Homepage (album grid)
/albums/                    Same as homepage
/albums/<slug>/             Album detail (photo grid)
/albums/<slug>/<photo-id>/  Individual photo (full size, caption, prev/next nav)
```

## meta.yml

See [meta.yml.example](meta.yml.example) for the full format.

```yaml
title: BWCA Trip 2026
description: Four days paddling the Boundary Waters.
cover: img003.jpg
cover_position: center   # center | top | bottom | left | right
protected: false

photos:
  - file: img003.jpg
    caption: Portaging into Knife Lake.
  - file: img001.jpg
    caption: Morning fog on the first day.
```

Photos not listed in `meta.yml` are appended at the end in filesystem order with a warning.

## Hosting

Designed for GitHub Pages with Cloudflare for custom domains. Albums marked `protected: true` can be gated with [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) (free tier, up to 50 users).

## Project structure

```
build.js              Build tool (resize, upload, generate HTML)
import.js             Import CLI (ingest photos into inbox)
lib/
  config.js           Paths, constants, env validation
  inbox.js            Inbox scanning, meta.yml parsing
  images.js           Sharp resizing + EXIF extraction
  cloudinary.js       Cloudinary upload/delete
  html.js             HTML generation + CSS
data/
  groups.json         Album index
  groups/<slug>.json  Per-album manifest
```
