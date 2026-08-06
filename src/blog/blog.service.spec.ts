import { BlogService } from './blog.service';
import { CreatePostDto } from './dto/post.dto';

// PrismaService simulado: solo lo que BlogService.create() usa.
type PostStub = { id: string; slug: string };

function makePrismaMock(existingSlugs: string[] = []) {
  const created: any[] = [];
  const prisma = {
    post: {
      // Devuelve un post si el slug ya existe (para probar unicidad).
      findUnique: jest.fn(
        ({ where: { slug } }: { where: { slug: string } }): Promise<PostStub | null> =>
          Promise.resolve(
            existingSlugs.includes(slug) ? { id: 'otro', slug } : null,
          ),
      ),
      // Devuelve los datos recibidos como si los hubiese persistido.
      create: jest.fn(({ data }: { data: any }) => {
        const post = { id: 'nuevo', ...data };
        created.push(post);
        return Promise.resolve(post);
      }),
    },
  };
  return { prisma, created };
}

function dto(title: string): CreatePostDto {
  return { title, content: 'Contenido de prueba' } as CreatePostDto;
}

describe('BlogService (slugify vía create)', () => {
  it('convierte acentos y espacios en un slug en minúsculas con guiones', async () => {
    const { prisma } = makePrismaMock();
    const service = new BlogService(prisma as any);

    const post = await service.create(dto('Ortodoncia Estética Avanzada'));

    expect(post.slug).toBe('ortodoncia-estetica-avanzada');
  });

  it('elimina diacríticos comunes (á é í ó ú ñ ü)', async () => {
    const { prisma } = makePrismaMock();
    const service = new BlogService(prisma as any);

    const post = await service.create(dto('Niño con Brácket: Guía Rápida ü'));

    expect(post.slug).toBe('nino-con-bracket-guia-rapida-u');
  });

  it('colapsa múltiples separadores y recorta guiones extremos', async () => {
    const { prisma } = makePrismaMock();
    const service = new BlogService(prisma as any);

    const post = await service.create(dto('  ¡Hola,   Mundo!  '));

    expect(post.slug).toBe('hola-mundo');
  });

  it('genera un slug por defecto cuando el título no tiene caracteres válidos', async () => {
    const { prisma } = makePrismaMock();
    const service = new BlogService(prisma as any);

    const post = await service.create(dto('¡!!! ¿¿¿'));

    expect(post.slug).toBe('post');
  });

  it('añade sufijo numérico si el slug base ya existe', async () => {
    // El slug 'ortodoncia' ya existe -> debe usar 'ortodoncia-2'.
    const { prisma } = makePrismaMock(['ortodoncia']);
    const service = new BlogService(prisma as any);

    const post = await service.create(dto('Ortodoncia'));

    expect(post.slug).toBe('ortodoncia-2');
  });

  it('persiste el slug generado en los datos enviados a Prisma', async () => {
    const { prisma, created } = makePrismaMock();
    const service = new BlogService(prisma as any);

    await service.create(dto('Limpieza Dental Profesional'));

    expect(created).toHaveLength(1);
    expect(created[0].slug).toBe('limpieza-dental-profesional');
  });
});
