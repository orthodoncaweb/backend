/**
 * Copia SOLO el catálogo (categorías, subcategorías, productos y variantes)
 * de una base de datos a otra. No toca clientes, pedidos, favoritos ni blog.
 *
 * Uso:
 *   1. En backend/.env:
 *        DATABASE_URL      -> base DESTINO (nueva)
 *        OLD_DATABASE_URL  -> base ORIGEN (vieja)
 *   2. Asegúrate de que la base destino ya tenga las tablas:
 *        npx prisma migrate deploy
 *   3. node scripts/copy-catalog.js [--dry-run]
 *
 * Es idempotente: usa upsert por id, así que se puede volver a ejecutar sin duplicar.
 * Conserva los IDs originales para que las URLs de imágenes y las relaciones sigan válidas.
 */
require('dotenv').config();
const { PrismaClient, Prisma } = require('@prisma/client');

const DRY_RUN = process.argv.includes('--dry-run');
// Vacía el catálogo del destino antes de copiar. Necesario cuando el destino
// ya tiene categorías creadas por el seed con los mismos slug pero otros ids
// (el slug es único, así que chocarían con las que se van a copiar).
const RESET = process.argv.includes('--reset');

const SOURCE_URL = process.env.OLD_DATABASE_URL;
const TARGET_URL = process.env.DATABASE_URL;

if (!SOURCE_URL) {
  console.error('❌ Falta OLD_DATABASE_URL en .env (base de origen).');
  process.exit(1);
}
if (!TARGET_URL) {
  console.error('❌ Falta DATABASE_URL en .env (base de destino).');
  process.exit(1);
}
if (SOURCE_URL === TARGET_URL) {
  console.error('❌ El origen y el destino son la misma base. Revisa las variables.');
  process.exit(1);
}

const source = new PrismaClient({ datasourceUrl: SOURCE_URL });
const target = new PrismaClient({ datasourceUrl: TARGET_URL });

// Prisma exige DbNull (no null) para columnas Json opcionales.
const json = (value) => (value === null || value === undefined ? Prisma.DbNull : value);

// Muestra el host de una cadena de conexión sin exponer credenciales.
function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return '(host desconocido)';
  }
}

async function main() {
  console.log(`Origen  : ${safeHost(SOURCE_URL)}`);
  console.log(`Destino : ${safeHost(TARGET_URL)}`);
  if (DRY_RUN) console.log('MODO DRY-RUN: no se escribe nada.\n');
  else console.log('');

  /* ---------- 0. Reset opcional del catálogo destino ---------- */
  if (RESET && !DRY_RUN) {
    // Salvaguarda: nunca borrar si el destino ya tiene catálogo o pedidos reales.
    const [prodCount, orderCount] = await Promise.all([
      target.product.count(),
      target.order.count(),
    ]);
    if (prodCount > 0 || orderCount > 0) {
      throw new Error(
        `El destino NO está vacío (productos: ${prodCount}, pedidos: ${orderCount}). ` +
          'Se cancela el reset para no borrar datos reales.',
      );
    }
    const delSubs = await target.subcategory.deleteMany({});
    const delCats = await target.category.deleteMany({});
    console.log(
      `Reset destino   : ${delCats.count} categorías y ${delSubs.count} subcategorías eliminadas\n`,
    );
  }

  /* ---------- 1. Categorías ---------- */
  const categories = await source.category.findMany({ orderBy: { order: 'asc' } });
  if (!DRY_RUN) {
    for (const c of categories) {
      await target.category.upsert({
        where: { id: c.id },
        update: { name: c.name, slug: c.slug, imageUrl: c.imageUrl, order: c.order },
        create: {
          id: c.id,
          name: c.name,
          slug: c.slug,
          imageUrl: c.imageUrl,
          order: c.order,
          createdAt: c.createdAt,
        },
      });
    }
  }
  console.log(`Categorías      : ${categories.length}`);

  /* ---------- 2. Subcategorías ---------- */
  const subcategories = await source.subcategory.findMany({ orderBy: { order: 'asc' } });
  if (!DRY_RUN) {
    for (const s of subcategories) {
      await target.subcategory.upsert({
        where: { id: s.id },
        update: { name: s.name, slug: s.slug, imageUrl: s.imageUrl, order: s.order },
        create: {
          id: s.id,
          name: s.name,
          slug: s.slug,
          imageUrl: s.imageUrl,
          order: s.order,
          categoryId: s.categoryId,
          createdAt: s.createdAt,
        },
      });
    }
  }
  console.log(`Subcategorías   : ${subcategories.length}`);

  /* ---------- 3. Productos ---------- */
  const products = await source.product.findMany({ orderBy: { createdAt: 'asc' } });
  if (!DRY_RUN) {
    let done = 0;
    for (const p of products) {
      const data = {
        name: p.name,
        sku: p.sku,
        description: p.description,
        price: p.price,
        images: p.images,
        stock: p.stock,
        hasVariants: p.hasVariants,
        attributes: json(p.attributes),
        externalId: p.externalId,
        categoryId: p.categoryId,
        subcategoryId: p.subcategoryId,
      };
      await target.product.upsert({
        where: { id: p.id },
        update: data,
        create: { id: p.id, ...data, createdAt: p.createdAt },
      });
      if (++done % 100 === 0) console.log(`  … ${done}/${products.length} productos`);
    }
  }
  console.log(`Productos       : ${products.length}`);

  /* ---------- 4. Variantes ---------- */
  const variants = await source.productVariant.findMany();
  if (!DRY_RUN) {
    for (const v of variants) {
      const data = {
        sku: v.sku,
        label: v.label,
        options: v.options,
        price: v.price,
        stock: v.stock,
        image: v.image,
        productId: v.productId,
      };
      await target.productVariant.upsert({
        where: { id: v.id },
        update: data,
        create: { id: v.id, ...data, createdAt: v.createdAt },
      });
    }
  }
  console.log(`Variantes       : ${variants.length}`);

  /* ---------- Verificación ---------- */
  console.log('\n--- Conteo final en la base DESTINO ---');
  const [cats, subs, prods, vars] = await Promise.all([
    target.category.count(),
    target.subcategory.count(),
    target.product.count(),
    target.productVariant.count(),
  ]);
  console.log(`  categorías    : ${cats}`);
  console.log(`  subcategorías : ${subs}`);
  console.log(`  productos     : ${prods}`);
  console.log(`  variantes     : ${vars}`);

  const ok =
    cats === categories.length &&
    subs === subcategories.length &&
    prods === products.length &&
    vars === variants.length;
  console.log(
    DRY_RUN
      ? '\n(dry-run: no se copió nada)'
      : ok
        ? '\n✅ Copia completa: los conteos coinciden con el origen.'
        : '\n⚠️ Los conteos NO coinciden con el origen. Revisa los mensajes anteriores.',
  );
}

main()
  .catch((err) => {
    console.error('❌ Error durante la copia:', err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await source.$disconnect();
    await target.$disconnect();
  });
