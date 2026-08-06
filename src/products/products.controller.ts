import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { AdminGuard } from '../auth/admin.guard';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // Público: GET /api/products?category=<slug>&subcategory=<slug>
  @Get()
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  findAll(
    @Query('category') category?: string,
    @Query('subcategory') subcategory?: string,
    @Query('limit') limit?: string,
  ) {
    return this.productsService.findAll({
      category,
      subcategory,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // Público: GET /api/products/search (debe ir ANTES de ':id' para no colisionar)
  @Get('search')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  search(
    @Query('search') search?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('category') category?: string,
    @Query('subcategory') subcategory?: string,
  ) {
    return this.productsService.searchPaginated({
      search,
      sort,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      category,
      subcategory,
    });
  }

  // Público: GET /api/products/:id/related?limit=4
  @Get(':id/related')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  related(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.productsService.findRelated(id, limit ? Number(limit) : 4);
  }

  // Público: GET /api/products/:id
  @Get(':id')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  // Admin: POST /api/products
  @UseGuards(AdminGuard)
  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  // Admin: PATCH /api/products/:id
  @UseGuards(AdminGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  // Admin: DELETE /api/products/:id
  @UseGuards(AdminGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }
}
