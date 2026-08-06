import { Module } from '@nestjs/common';
import { BlogService } from './blog.service';
import { BlogController } from './blog.controller';
import { BlogAdminController } from './blog-admin.controller';

@Module({
  controllers: [BlogController, BlogAdminController],
  providers: [BlogService],
})
export class BlogModule {}
