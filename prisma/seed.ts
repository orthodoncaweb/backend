import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const categoriesSeed: {
  name: string;
  imageUrl: string;
  subcategories?: string[];
}[] = [
  {
    name: 'Ortodoncia',
    imageUrl: '/home/categorias/ortodoncia.png',
    subcategories: [
      'Alambres',
      'Arcos',
      'Arcos estéticos',
      'Auxiliares',
      'Bandas y tubos',
      'Brackets estéticos',
      'Brackets metálicos',
      'Elásticos',
      'Expansor',
      'Láminas de acrílico',
      'Ligaduras metálicas',
      'Pinzas',
      'Resinas',
      'Resortes',
      'Retenedores linguales',
      'Sistema de máximo anclaje esqueletal y auxiliares',
      'Ortodoncia Línea Accesible',
    ],
  },
  { name: 'Equipos dentales', imageUrl: '/home/categorias/equipos_dentales.png' },
  { name: 'Endodoncia', imageUrl: '/home/categorias/endodoncia.png' },
  { name: 'Implantes', imageUrl: '/home/categorias/implantes.png' },
  { name: 'Material Regenerativo', imageUrl: '/home/categorias/material%20regenerativo.png' },
  { name: 'Odontología General', imageUrl: '/home/categorias/ortodoncia_general.png' },
];

async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL ?? 'admin@orthodonca.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? 'Admin1234';
  const name = process.env.ADMIN_NAME ?? 'Administrador';
  const hashedPassword = bcrypt.hashSync(password, 10);

  await prisma.user.upsert({
    where: { email },
    update: { name, role: Role.ADMIN },
    create: { email, password: hashedPassword, name, role: Role.ADMIN },
  });
  console.log(`✅ Usuario administrador listo: ${email}`);
}

async function seedCategories() {
  for (let i = 0; i < categoriesSeed.length; i++) {
    const cat = categoriesSeed[i];
    const slug = slugify(cat.name);
    const category = await prisma.category.upsert({
      where: { slug },
      update: { name: cat.name, imageUrl: cat.imageUrl, order: i },
      create: { name: cat.name, slug, imageUrl: cat.imageUrl, order: i },
    });

    const subs = cat.subcategories ?? [];
    for (let j = 0; j < subs.length; j++) {
      const subName = subs[j];
      const subSlug = slugify(subName);
      await prisma.subcategory.upsert({
        where: { categoryId_slug: { categoryId: category.id, slug: subSlug } },
        update: { name: subName, order: j },
        create: { name: subName, slug: subSlug, order: j, categoryId: category.id },
      });
    }
  }
  console.log(`✅ Categorías y subcategorías sembradas (${categoriesSeed.length} categorías)`);
}

async function main() {
  await seedAdmin();
  await seedCategories();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('❌ Error al ejecutar el seed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
