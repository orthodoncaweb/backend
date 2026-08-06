import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateSubcategoryDto, UpdateSubcategoryDto } from './dto/category.dto';
import { AdminGuard } from '../auth/admin.guard';

@UseGuards(AdminGuard)
@Controller('subcategories')
export class SubcategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  // Admin: POST /api/subcategories
  @Post()
  create(@Body() dto: CreateSubcategoryDto) {
    return this.categoriesService.createSubcategory(dto);
  }

  // Admin: PATCH /api/subcategories/:id
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSubcategoryDto) {
    return this.categoriesService.updateSubcategory(id, dto);
  }

  // Admin: DELETE /api/subcategories/:id
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.categoriesService.deleteSubcategory(id);
  }
}
