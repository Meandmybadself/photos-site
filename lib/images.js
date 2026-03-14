import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import exifReader from 'exif-reader';
import { PATHS, VARIANTS } from './config.js';

export async function resizePhoto(sourcePath, slug, photoId, coverPosition = 'attention') {
  const outDir = join(PATHS.build, slug);
  await mkdir(outDir, { recursive: true });

  // Extract EXIF before resizing
  const exif = await extractExif(sourcePath);

  const [full, thumb, cover] = await Promise.all([
    sharp(sourcePath)
      .rotate()
      .resize({ width: VARIANTS.full.width, withoutEnlargement: true })
      .webp({ quality: VARIANTS.full.quality })
      .toFile(join(outDir, `${photoId}-full.webp`)),

    sharp(sourcePath)
      .rotate()
      .resize({ width: VARIANTS.thumb.width, withoutEnlargement: true })
      .webp({ quality: VARIANTS.thumb.quality })
      .toFile(join(outDir, `${photoId}-thumb.webp`)),

    sharp(sourcePath)
      .rotate()
      .resize(VARIANTS.cover.width, VARIANTS.cover.height, {
        fit: 'cover',
        position: coverPosition,
      })
      .webp({ quality: VARIANTS.cover.quality })
      .toFile(join(outDir, `${photoId}-cover.webp`)),
  ]);

  return {
    full: { path: join(outDir, `${photoId}-full.webp`), width: full.width, height: full.height },
    thumb: { path: join(outDir, `${photoId}-thumb.webp`), width: thumb.width, height: thumb.height },
    cover: { path: join(outDir, `${photoId}-cover.webp`), width: cover.width, height: cover.height },
    exif,
  };
}

async function extractExif(sourcePath) {
  try {
    const meta = await sharp(sourcePath).metadata();
    if (!meta.exif) return null;

    const parsed = exifReader(meta.exif);
    const exif = {};

    // Date taken
    const date = parsed.exif?.DateTimeOriginal ?? parsed.exif?.DateTimeDigitized;
    if (date) exif.dateTaken = date instanceof Date ? date.toISOString() : String(date);

    // Camera
    if (parsed.image?.Make) exif.cameraMake = parsed.image.Make.trim();
    if (parsed.image?.Model) exif.cameraModel = parsed.image.Model.trim();

    // Lens
    if (parsed.exif?.LensModel) exif.lens = parsed.exif.LensModel.trim();

    // Exposure settings
    if (parsed.exif?.FocalLength) exif.focalLength = parsed.exif.FocalLength;
    if (parsed.exif?.FNumber) exif.aperture = parsed.exif.FNumber;
    if (parsed.exif?.ExposureTime) exif.exposureTime = parsed.exif.ExposureTime;
    if (parsed.exif?.ISOSpeedRatings != null) exif.iso = parsed.exif.ISOSpeedRatings;
    // Some cameras use PhotographicSensitivity instead
    if (exif.iso == null && parsed.exif?.PhotographicSensitivity != null) {
      exif.iso = parsed.exif.PhotographicSensitivity;
    }

    // GPS
    if (parsed.gps?.GPSLatitude && parsed.gps?.GPSLongitude) {
      exif.gps = {
        latitude: dmsToDecimal(parsed.gps.GPSLatitude, parsed.gps.GPSLatitudeRef),
        longitude: dmsToDecimal(parsed.gps.GPSLongitude, parsed.gps.GPSLongitudeRef),
      };
    }

    // Image dimensions (original, before resize)
    if (meta.width) exif.originalWidth = meta.width;
    if (meta.height) exif.originalHeight = meta.height;

    return Object.keys(exif).length > 0 ? exif : null;
  } catch {
    return null;
  }
}

function dmsToDecimal(dms, ref) {
  if (!Array.isArray(dms) || dms.length < 3) return null;
  let decimal = dms[0] + dms[1] / 60 + dms[2] / 3600;
  if (ref === 'S' || ref === 'W') decimal = -decimal;
  return Math.round(decimal * 1000000) / 1000000;
}

export async function cleanBuildDir(slug) {
  await rm(join(PATHS.build, slug), { recursive: true, force: true });
}
