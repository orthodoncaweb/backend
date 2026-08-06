import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

// ConfigModule es global, no se importa aquí
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
