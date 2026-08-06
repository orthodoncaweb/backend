/**
 * Limpieza de categorías para que coincidan con orthodonca.com:
 *  - Borra categorías vacías sobrantes (sembradas y sin productos).
 *  - Mueve "DSI" a subcategoría de Implantodontología.
 *  - Quita la subcategoría duplicada "Ortodoncia Línea Accesible" bajo Ortodoncia.
 *  - Asigna imágenes a las categorías/subcategorías que no la tienen.
 *  - Ordena las categorías como en el sitio.
 *
 * Uso: node scripts/fix-categories.js
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const log = (...a) => console.log('  ', ...a);

async function firstProductImage(where) {
  const pr = await prisma.product.findFirst({
    where: { ...where, images: { isEmpty: false } },
    select: { images: true },
  });
  return pr ? pr.images[0] : null;
}

async function main() {
  // A) Borra categorías vacías sobrantes (no están en el sitio real).
  console.log('A) Categorías vacías sobrantes…');
  for (const slug of ['equipos-dentales', 'endodoncia', 'implantes']) {
    const c = await prisma.category.findFirst({
      where: { slug },
      include: { _count: { select: { products: true, subcategories: true } } },
    });
    if (c && c._count.products === 0 && c._count.subcategories === 0) {
      await prisma.category.delete({ where: { id: c.id } });
      log('borrada:', c.name);
    } else if (c) {
      log('conservada (tiene contenido):', c.name);
    }
  }

  // B) DSI → subcategoría de Implantodontología.
  console.log('B) DSI → subcategoría de Implantodontología…');
  const impl = await prisma.category.findFirst({ where: { slug: 'implantodontologia' } });
  const dsiCat = await prisma.category.findFirst({
    where: { slug: 'dsi' },
    include: { products: { select: { id: true } } },
  });
  if (impl && dsiCat) {
    let dsiSub = await prisma.subcategory.findFirst({
      where: { categoryId: impl.id, slug: 'dsi' },
    });
    if (!dsiSub) {
      dsiSub = await prisma.subcategory.create({
        data: { name: 'DSI', slug: 'dsi', categoryId: impl.id, order: 1 },
      });
    }
    for (const prod of dsiCat.products) {
      await prisma.product.update({
        where: { id: prod.id },
        data: { categoryId: impl.id, subcategoryId: dsiSub.id },
      });
    }
    log(`movidos ${dsiCat.products.length} producto(s) a Implantodontología > DSI`);
    await prisma.category.delete({ where: { id: dsiCat.id } });
    log('borrada categoría DSI (ahora es subcategoría)');
  }

  // C) Subcategoría duplicada "Ortodoncia Línea Accesible" bajo Ortodoncia.
  console.log('C) Subcategoría duplicada bajo Ortodoncia…');
  const orto = await prisma.category.findFirst({ where: { slug: 'ortodoncia' } });
  if (orto) {
    const dup = await prisma.subcategory.findFirst({
      where: { categoryId: orto.id, name: { contains: 'Accesible' } },
      include: { _count: { select: { products: true } } },
    });
    if (dup && dup._count.products === 0) {
      await prisma.subcategory.delete({ where: { id: dup.id } });
      log('borrada subcategoría duplicada:', dup.name);
    } else if (dup) {
      log('conservada (tiene productos):', dup.name);
    }
  }

  // D) Imágenes de categorías top-level faltantes.
  console.log('D) Imágenes de categorías…');
  const catImg = {
    implantodontologia: '/home/categorias/implantes.png',
    'ortodoncia-linea-accesible': '/home/categorias/ortodoncia.png',
  };
  for (const [slug, url] of Object.entries(catImg)) {
    const c = await prisma.category.findFirst({ where: { slug } });
    if (c && !c.imageUrl) {
      await prisma.category.update({ where: { id: c.id }, data: { imageUrl: url } });
      log('imagen asignada a', c.name);
    }
  }
  // Equipos eighteeth: usa la imagen de uno de sus productos (en R2).
  const eq = await prisma.category.findFirst({ where: { slug: 'equipos-eighteeth' } });
  if (eq && !eq.imageUrl) {
    const img = await firstProductImage({ categoryId: eq.id });
    if (img) {
      await prisma.category.update({ where: { id: eq.id }, data: { imageUrl: img } });
      log('imagen (de producto) asignada a Equipos eighteeth');
    }
  }

  // E) Imágenes de subcategorías faltantes → imagen de un producto de esa sub.
  console.log('E) Imágenes de subcategorías…');
  const subs = await prisma.subcategory.findMany({ where: { imageUrl: null } });
  let fixed = 0;
  for (const s of subs) {
    const img = await firstProductImage({ subcategoryId: s.id });
    if (img) {
      await prisma.subcategory.update({ where: { id: s.id }, data: { imageUrl: img } });
      fixed++;
    }
  }
  log(`subcategorías con imagen asignada: ${fixed} de ${subs.length}`);

  // F) Orden según el sitio.
  console.log('F) Orden de categorías…');
  const order = {
    'equipos-eighteeth': 0,
    ortodoncia: 1,
    'ortodoncia-linea-accesible': 2,
    'odontologia-general': 3,
    implantodontologia: 4,
    'material-regenerativo': 5,
  };
  for (const [slug, o] of Object.entries(order)) {
    await prisma.category.updateMany({ where: { slug }, data: { order: o } });
  }
  log('orden actualizado');

  console.log('\n✅ Limpieza de categorías completada.');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
