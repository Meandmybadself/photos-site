import { v2 as cloudinary } from 'cloudinary';
import { requireEnv } from './config.js';

let configured = false;

export function initCloudinary() {
  if (configured) return;
  cloudinary.config({
    cloud_name: requireEnv('CLOUDINARY_CLOUD_NAME'),
    api_key: requireEnv('CLOUDINARY_API_KEY'),
    api_secret: requireEnv('CLOUDINARY_API_SECRET'),
  });
  configured = true;
}

export async function uploadPhotoVariants(resized, slug, photoId) {
  initCloudinary();

  const upload = async (localPath, suffix) => {
    const publicId = `${slug}/${photoId}-${suffix}`;
    const result = await cloudinary.uploader.upload(localPath, {
      public_id: publicId,
      overwrite: true,
      resource_type: 'image',
      format: 'webp',
    });
    return { cloudinaryId: publicId, url: result.secure_url };
  };

  const [full, thumb, cover] = await Promise.all([
    upload(resized.full.path, 'full'),
    upload(resized.thumb.path, 'thumb'),
    upload(resized.cover.path, 'cover'),
  ]);

  return {
    full: { ...full, width: resized.full.width, height: resized.full.height },
    thumb: { ...thumb, width: resized.thumb.width, height: resized.thumb.height },
    cover: { ...cover, width: resized.cover.width, height: resized.cover.height },
  };
}

export async function deletePhotoAssets(slug, photoId) {
  initCloudinary();
  const suffixes = ['full', 'thumb', 'cover'];
  await Promise.all(
    suffixes.map(s => cloudinary.uploader.destroy(`${slug}/${photoId}-${s}`, { resource_type: 'image' }))
  );
}

export async function deleteAlbumAssets(slug, photoIds) {
  initCloudinary();
  for (const photoId of photoIds) {
    await deletePhotoAssets(slug, photoId);
  }
  // Try to remove the folder (may fail if not empty, that's fine)
  try {
    await cloudinary.api.delete_folder(slug);
  } catch {
    // Folder may not exist or may not be empty
  }
}
