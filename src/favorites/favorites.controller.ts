import { Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { CustomerGuard } from '../auth/customer.guard';

@UseGuards(CustomerGuard)
@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  // GET /api/favorites -> productos favoritos del cliente
  @Get()
  list(@Req() req: { user: { id: string } }) {
    return this.favoritesService.listForCustomer(req.user.id);
  }

  // POST /api/favorites/:productId -> { added:true }
  @Post(':productId')
  add(@Req() req: { user: { id: string } }, @Param('productId') productId: string) {
    return this.favoritesService.add(req.user.id, productId);
  }

  // DELETE /api/favorites/:productId -> { removed:true }
  @Delete(':productId')
  remove(@Req() req: { user: { id: string } }, @Param('productId') productId: string) {
    return this.favoritesService.remove(req.user.id, productId);
  }
}
