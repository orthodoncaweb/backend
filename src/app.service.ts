import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return {
      status: 'ok',
      service: 'orthodonca-ecommerce-api',
      timestamp: new Date().toISOString(),
    };
  }
}
