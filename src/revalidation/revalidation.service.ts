import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Etiquetas de caché que usa el frontend (ver frontend/src/lib/products.ts).
export const PRODUCTS_TAG = 'products';
export const productTag = (id: string) => `product:${id}`;

const REQUEST_TIMEOUT_MS = 5000;

/**
 * Avisa al frontend (Next.js) que purgue su caché cuando cambia el catálogo.
 * El envío es "fire and forget": si el frontend no responde, el guardado en el
 * panel NO falla ni se ralentiza; a lo sumo la página se refresca por tiempo.
 */
@Injectable()
export class RevalidationService {
  private readonly logger = new Logger(RevalidationService.name);
  private readonly baseUrl: string | null;
  private readonly secret: string | null;
  private warned = false;

  constructor(config: ConfigService) {
    const frontend =
      config.get<string>('FRONTEND_URL')?.trim() ||
      // Fallback: el primer origen de la lista blanca de CORS.
      config.get<string>('CORS_ORIGINS')?.split(',')[0]?.trim() ||
      '';
    this.baseUrl = frontend ? frontend.replace(/\/+$/, '') : null;
    this.secret = config.get<string>('REVALIDATE_SECRET')?.trim() || null;
  }

  get isConfigured(): boolean {
    return Boolean(this.baseUrl && this.secret);
  }

  /** Purga las etiquetas indicadas. No lanza: solo registra el fallo. */
  revalidateTags(tags: string[]): void {
    const clean = [...new Set(tags.filter(Boolean))];
    if (!clean.length) return;

    if (!this.isConfigured) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          'Revalidación del frontend NO configurada (falta FRONTEND_URL o REVALIDATE_SECRET). ' +
            'Los cambios del catálogo se reflejarán por tiempo, no al instante.',
        );
      }
      return;
    }

    void this.send(clean).catch((err: Error) =>
      this.logger.warn(`No se pudo purgar la caché del frontend: ${err.message}`),
    );
  }

  /** Purga la ficha de un producto y todos los listados del catálogo. */
  revalidateProduct(id?: string): void {
    this.revalidateTags(id ? [PRODUCTS_TAG, productTag(id)] : [PRODUCTS_TAG]);
  }

  private async send(tags: string[]): Promise<void> {
    const res = await fetch(`${this.baseUrl as string}/revalidate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-revalidate-secret': this.secret as string,
      },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`el frontend respondió ${res.status} ${detail.slice(0, 200)}`);
    }
    this.logger.log(`Caché del frontend purgada: ${tags.join(', ')}`);
  }
}
