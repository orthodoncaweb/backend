import { Controller, Get, Header, Param } from '@nestjs/common';
import { BlogService } from './blog.service';

// Rutas públicas del blog
@Controller('posts')
export class BlogController {
  constructor(private readonly blog: BlogService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  findPublished() {
    return this.blog.findPublished();
  }

  @Get(':slug')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  findBySlug(@Param('slug') slug: string) {
    return this.blog.findBySlug(slug);
  }
}
