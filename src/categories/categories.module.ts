import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { SubcategoriesController } from './subcategories.controller';

@Module({
  controllers: [CategoriesController, SubcategoriesController],
  providers: [CategoriesService],
})
export class CategoriesModule {}
