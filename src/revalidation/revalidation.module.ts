import { Global, Module } from '@nestjs/common';
import { RevalidationService } from './revalidation.service';

// Global: cualquier módulo que cambie contenido público puede inyectarlo.
@Global()
@Module({
  providers: [RevalidationService],
  exports: [RevalidationService],
})
export class RevalidationModule {}
