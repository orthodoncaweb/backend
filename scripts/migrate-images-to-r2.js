/**
 * Migra las imágenes guardadas localmente (backend/uploads, servidas en /uploads)
 * a Cloudflare R2 y actualiza las URLs en la base de datos.
 *
 * Migra: Category.imageUrl, Subcategory.imageUrl, Product.images[].
 * No borra los archivos locales (los snapshots de pedidos siguen usándolos).
 *
 * Uso:  node scripts/migrate-images-to-r2.js   (desde la carpeta backend)
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { readFile } = require('fs/promises');
const { existsSync } = require('fs');
const { join, extname } = require('path');

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_URL,
} = process.env;

if (
  !R2_ACCOUNT_ID ||
  !R2_ACCESS_KEY_ID ||
  !R2_SECRET_ACCESS_KEY ||
  !R2_BUCKET ||
  !R2_PUBLIC_URL
) {
  console.error('❌ R2 no está completamente configurado en backend/.env');
  process.exit(1);
}

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

const publicBase = R2_PUBLIC_URL.replace(/\/$/, '');
const uploadsDir = join(process.cwd(), 'uploads');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});
const prisma = new PrismaClient();

const isLocal = (url) => typeof url === 'string' && url.includes('/uploads/');
const filenameOf = (url) => url.split('/uploads/').pop();

const cache = new Map(); // filename -> nueva URL R2 (evita resubir el mismo archivo)
let uploaded = 0;
let missing = 0;

async function migrateUrl(url) {
  if (!isLocal(url)) return url; // ya es R2 u otra fuente
  const filename = filenameOf(url);
  if (cache.has(filename)) return cache.get(filename);

  const filePath = join(uploadsDir, filename);
  if (!existsSync(filePath)) {
    console.warn('   ⚠ archivo no encontrado en disco:', filename);
    missing++;
    return url; // deja la URL original
  }

  const body = await readFile(filePath);
  const ext = extname(filename).toLowerCase();
  const key = `categories/${filename}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: MIME[ext] || 'application/octet-stream',
    }),
  );
  const newUrl = `${publicBase}/${key}`;
  cache.set(filename, newUrl);
  uploaded++;
  return newUrl;
}

async function main() {
  console.log('→ Migrando categorías…');
  for (const c of await prisma.category.findMany()) {
    if (isLocal(c.imageUrl)) {
      const nu = await migrateUrl(c.imageUrl);
      if (nu !== c.imageUrl) {
        await prisma.category.update({ where: { id: c.id }, data: { imageUrl: nu } });
        console.log('   ✓', c.name);
      }
    }
  }

  console.log('→ Migrando subcategorías…');
  for (const s of await prisma.subcategory.findMany()) {
    if (isLocal(s.imageUrl)) {
      const nu = await migrateUrl(s.imageUrl);
      if (nu !== s.imageUrl) {
        await prisma.subcategory.update({ where: { id: s.id }, data: { imageUrl: nu } });
        console.log('   ✓', s.name);
      }
    }
  }

  console.log('→ Migrando productos…');
  for (const p of await prisma.product.findMany()) {
    const imgs = p.images || [];
    let changed = false;
    const newImgs = [];
    for (const img of imgs) {
      const nu = await migrateUrl(img);
      if (nu !== img) changed = true;
      newImgs.push(nu);
    }
    if (changed) {
      await prisma.product.update({ where: { id: p.id }, data: { images: newImgs } });
      console.log('   ✓', p.name, `(${newImgs.length} img)`);
    }
  }

  console.log(`\n✅ Listo. Subidas a R2: ${uploaded} | Archivos locales faltantes: ${missing}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
