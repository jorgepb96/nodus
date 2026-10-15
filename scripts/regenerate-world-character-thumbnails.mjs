import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetDir = path.join(root, 'electron/assets/worldbuilding-demo');
const entries = (await fs.readdir(assetDir))
  .filter((name) => /^character-[a-z0-9-]+\.original\.webp$/.test(name))
  .sort();

for (const originalName of entries) {
  const originalPath = path.join(assetDir, originalName);
  const thumbnailPath = originalPath.replace(/\.original\.webp$/, '.webp');
  const thumbnail = await sharp(originalPath)
    .rotate()
    .resize({ width: 360, height: 480, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 84, effort: 6 })
    .toBuffer();
  await fs.writeFile(thumbnailPath, thumbnail);
  process.stdout.write(`${path.basename(thumbnailPath)}\n`);
}

process.stdout.write(`Regenerated ${entries.length} character thumbnails from their matching originals.\n`);
