# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A static, self-hosted photo site. Source photos are resized locally with **sharp**, uploaded to **Cloudinary** for CDN delivery, and every page is pre-rendered as static HTML served by **GitHub Pages** from the repo root. See `README.md` for end-user import/build instructions and the `meta.yml` format.

## Commands

```bash
pnpm build      # Full pipeline: process inbox -> resize -> upload to Cloudinary -> regenerate all HTML
pnpm regen      # Regenerate HTML only, from data/ manifests. No image/Cloudinary work. Fast & offline.
pnpm ingest -- <srcDir> --name "Title" [--description "..."] [--protected]   # Stage an album into inbox/
pnpm watch -- <dir>     # Watch a folder; auto-ingest dropped images as singles via repeated `pnpm build`

node --env-file=.env build.js --delete <slug> [photoId]   # Delete album or one photo (also removes from Cloudinary)
node --env-file=.env build.js --delete-single <photoId>   # Delete a single photo
```

There is no test suite, linter, or typecheck. `build`/`regen`/`delete` require `.env` with `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (see `.env.example`); `--env-file=.env` is wired into the npm scripts. Requires Node 22+ and pnpm.

## Architecture

The data flow is **inbox → data manifests → generated HTML**, with Cloudinary as the image host. `data/` is the source of truth; HTML is a pure projection of it.

- **`build.js`** — orchestrator and CLI. `parseArgs` selects a mode (`full` / `regen` / `delete` / `delete-single`); each `cmd*` function ends by rebuilding `data/groups.json` and calling `generateSite`. Holds the manifest read/write helpers and the **singles** logic.
- **`lib/config.js`** — all paths (`PATHS`), `SUPPORTED_EXTENSIONS`, image `VARIANTS` (full 2400w / thumb 600w / cover 800×600), and `requireEnv`. Change sizes/quality here.
- **`lib/inbox.js`** — `scanInbox` / `parseInboxGroup` read `inbox/<slug>/meta.yml` + images into an in-memory group. `slugify` derives every photo `id` from its filename and is the join key throughout. Photos listed in `meta.yml` come first in that order; unlisted images are appended with a warning; two files that slugify to the same id throw a collision error.
- **`lib/images.js`** — `resizePhoto` writes the three WebP variants to `.build/<slug>/` (temp, gitignored) and `extractExif` pulls camera/lens/exposure/GPS/date via `exif-reader`. `.rotate()` bakes in EXIF orientation.
- **`lib/cloudinary.js`** — upload/delete. Cloudinary `public_id` is `<slug>/<photoId>-<full|thumb|cover>`; the returned `secure_url`s are stored in the manifest.
- **`lib/html.js`** — `generateSite` / `generateAlbumPages`. All markup and CSS are string templates here; always escape interpolated text with `esc`. This is the only place that emits the committed HTML.

### Two content types

1. **Albums** — `inbox/<slug>/` with a `meta.yml`. Manifest: `data/groups/<slug>.json`. Pages: `albums/<slug>/` and `albums/<slug>/<photoId>/`.
2. **Singles** — loose images dropped in `inbox/_singles/` (optionally a `<id>.json` sidecar for a caption). Manifest: `data/singles.json`. Pages under `photos/<id>/`. Uses the reserved slug `_singles`; `scanInbox` skips that dir.

### Incremental builds

`cmdFull` is idempotent: for each inbox group it diffs photo `id`s against the existing manifest and processes **only new photos**, then merges (existing photos keep their order, new ones append). On a successful album build the `inbox/<slug>/` source dir is deleted. A photo that fails to resize/upload is rolled back from Cloudinary and skipped (`[SKIP]`), not fatal. To re-process a photo, delete it first.

### Generated output is committed

`index.html`, `albums/**`, `photos/**`, `data/**`, `assets/`, and `CNAME` are all tracked in git — GitHub Pages serves them from the repo root, so a build's output must be committed to publish. `inbox/`, `.build/`, `node_modules/`, and `.env` are gitignored. After any content change run `pnpm build` (or `pnpm regen` for metadata-only edits like captions/order in `data/groups/<slug>.json`), then commit the regenerated files.

`protected: true` albums are flagged in the manifest/index for gating at the host level (Cloudflare Access); the build does not itself enforce access.
