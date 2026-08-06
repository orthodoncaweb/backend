import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostDto, UpdatePostDto } from './dto/post.dto';

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // elimina acentos/diacríticos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class BlogService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Slug único ----

  private async uniqueSlug(title: string, excludeId?: string) {
    const base = slugify(title) || 'post';
    let slug = base;
    let i = 2;
    for (;;) {
      const existing = await this.prisma.post.findUnique({ where: { slug } });
      if (!existing || existing.id === excludeId) return slug;
      slug = `${base}-${i++}`;
    }
  }

  // ---- Lectura pública ----

  findPublished() {
    return this.prisma.post.findMany({
      where: { published: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findBySlug(slug: string) {
    const post = await this.prisma.post.findUnique({ where: { slug } });
    if (!post || !post.published) {
      throw new NotFoundException('Publicación no encontrada');
    }
    return post;
  }

  // ---- Admin ----

  findAllAdmin() {
    return this.prisma.post.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async create(dto: CreatePostDto) {
    const slug = await this.uniqueSlug(dto.title);
    return this.prisma.post.create({
      data: {
        title: dto.title,
        slug,
        excerpt: dto.excerpt || null,
        content: dto.content,
        coverImage: dto.coverImage || null,
        published: dto.published ?? true,
      },
    });
  }

  async update(id: string, dto: UpdatePostDto) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Publicación no encontrada');

    // Re-genera el slug solo si cambia el título
    const slug = dto.title ? await this.uniqueSlug(dto.title, id) : post.slug;

    return this.prisma.post.update({
      where: { id },
      data: {
        title: dto.title ?? post.title,
        slug,
        excerpt: dto.excerpt !== undefined ? dto.excerpt || null : post.excerpt,
        content: dto.content ?? post.content,
        coverImage:
          dto.coverImage !== undefined ? dto.coverImage || null : post.coverImage,
        published: dto.published ?? post.published,
      },
    });
  }

  async remove(id: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Publicación no encontrada');
    await this.prisma.post.delete({ where: { id } });
    return { deleted: true };
  }
}
