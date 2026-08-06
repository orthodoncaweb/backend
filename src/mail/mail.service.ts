import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

// Estructura mínima de orden usada en los correos
interface MailOrderItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

interface MailOrder {
  id: number | string;
  total: number;
  currency?: string; // 'usd' | 'ves' — define el símbolo del monto.
  items: MailOrderItem[];
}

// Datos extra para el aviso de pedido al personal administrativo.
interface AdminOrderInfo extends MailOrder {
  customerName?: string;
  customerEmail?: string;
  paymentMethod?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter | null = null;
  private readonly isConfigured: boolean;
  private readonly from: string;
  private warnedOnce = false;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
    const secure =
      String(this.config.get<string>('SMTP_SECURE') ?? '').toLowerCase() ===
      'true';
    this.from =
      this.config.get<string>('SMTP_FROM') ?? 'Orthodonca <no-reply@orthodonca.com>';

    // Requiere al menos host y user para considerarse configurado
    this.isConfigured = Boolean(host && user);

    if (this.isConfigured) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user ? { user, pass } : undefined,
      });
    }
  }

  // Avisa una sola vez que el correo está deshabilitado
  private warnNotConfigured(): void {
    if (!this.warnedOnce) {
      this.logger.warn(
        'SMTP no configurado (falta SMTP_HOST/SMTP_USER): los correos están deshabilitados (no-op).',
      );
      this.warnedOnce = true;
    }
  }

  // Envío central con try/catch; nunca lanza
  private async send(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    if (!this.isConfigured || !this.transporter) {
      this.warnNotConfigured();
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
      });
    } catch (err) {
      this.logger.error(
        `Error al enviar correo "${subject}" a ${to}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Envoltura HTML con marca Orthodonca
  private layout(title: string, body: string): string {
    return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6f8;padding:24px;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <div style="background:#0f1f3d;padding:20px 24px;">
          <h1 style="color:#ffffff;margin:0;font-size:20px;letter-spacing:0.5px;">Orthodonca</h1>
        </div>
        <div style="padding:24px;color:#1f2937;font-size:15px;line-height:1.6;">
          <h2 style="margin:0 0 16px;color:#0f1f3d;font-size:18px;">${title}</h2>
          ${body}
        </div>
        <div style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;">
          Este es un correo automático de Orthodonca. Por favor no respondas a este mensaje.
        </div>
      </div>
    </div>`;
  }

  // Da formato a un monto según la moneda (USD por defecto, o Bs.).
  private money(amount: number, currency?: string): string {
    if ((currency ?? 'usd').toLowerCase() === 'ves') {
      return `Bs. ${Number(amount).toLocaleString('es-VE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
    return `$${Number(amount).toFixed(2)}`;
  }

  async sendWelcome(to: string, name: string): Promise<void> {
    const body = `
      <p>Hola <strong>${name}</strong>,</p>
      <p>Te damos la bienvenida a <strong>Orthodonca</strong>. Tu cuenta ha sido creada con éxito.</p>
      <p>Ya puedes explorar nuestro catálogo y realizar tus pedidos.</p>
      <p>¡Gracias por confiar en nosotros!</p>`;
    await this.send(to, 'Bienvenido a Orthodonca', this.layout('¡Bienvenido!', body));
  }

  async sendOrderConfirmation(to: string, order: MailOrder): Promise<void> {
    const rows = (order.items ?? [])
      .map(
        (item) => `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">${item.name}</td>
          <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:center;">${item.quantity}</td>
          <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;">${this.money(
            item.unitPrice,
            order.currency,
          )}</td>
        </tr>`,
      )
      .join('');

    const body = `
      <p>Hemos recibido tu pedido <strong>#${order.id}</strong>. ¡Gracias por tu compra!</p>
      <p>En breve te contactaremos por WhatsApp para coordinar el pago y el envío.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px 0;border-bottom:2px solid #0f1f3d;">Producto</th>
            <th style="text-align:center;padding:8px 0;border-bottom:2px solid #0f1f3d;">Cant.</th>
            <th style="text-align:right;padding:8px 0;border-bottom:2px solid #0f1f3d;">Precio</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="text-align:right;font-size:16px;"><strong>Total: ${this.money(
        order.total,
        order.currency,
      )}</strong></p>`;
    await this.send(
      to,
      `Confirmación de pedido #${order.id} - Orthodonca`,
      this.layout('Confirmación de pedido', body),
    );
  }

  // Aviso al personal administrativo de un pedido nuevo (pendiente de pago).
  async sendNewOrderToAdmin(to: string, order: AdminOrderInfo): Promise<void> {
    const rows = (order.items ?? [])
      .map(
        (item) => `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">${item.name}</td>
          <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:center;">${item.quantity}</td>
          <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;">${this.money(
            item.unitPrice,
            order.currency,
          )}</td>
        </tr>`,
      )
      .join('');

    const body = `
      <p>Se registró un <strong>nuevo pedido</strong> pendiente de pago.</p>
      <table style="width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:14px;">
        <tr><td style="padding:4px 0;color:#6b7280;">Pedido</td><td style="padding:4px 0;text-align:right;"><strong>#${order.id}</strong></td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Cliente</td><td style="padding:4px 0;text-align:right;">${order.customerName ?? '—'}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Correo</td><td style="padding:4px 0;text-align:right;">${order.customerEmail ?? '—'}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Método de pago</td><td style="padding:4px 0;text-align:right;">${order.paymentMethod ?? '—'}</td></tr>
      </table>
      <table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:14px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px 0;border-bottom:2px solid #0f1f3d;">Producto</th>
            <th style="text-align:center;padding:8px 0;border-bottom:2px solid #0f1f3d;">Cant.</th>
            <th style="text-align:right;padding:8px 0;border-bottom:2px solid #0f1f3d;">Precio</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="text-align:right;font-size:16px;"><strong>Total: ${this.money(
        order.total,
        order.currency,
      )}</strong></p>
      <p style="font-size:13px;color:#6b7280;">Coordina el pago con el cliente y actualiza el estado del pedido en el panel.</p>`;
    await this.send(
      to,
      `Nuevo pedido #${order.id} (pendiente) - Orthodonca`,
      this.layout('Nuevo pedido pendiente', body),
    );
  }

  // Correo de verificación de cuenta al registrarse (incluye bienvenida).
  async sendVerifyEmail(to: string, name: string, link: string): Promise<void> {
    const body = `
      <p>Hola <strong>${name}</strong>,</p>
      <p>Te damos la bienvenida a <strong>Orthodonca</strong>. Para activar tu cuenta, confirma tu correo electrónico:</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${link}" style="background:#0f1f3d;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:9999px;display:inline-block;font-size:15px;">Verificar mi correo</a>
      </p>
      <p style="font-size:13px;color:#6b7280;">Si no creaste esta cuenta, puedes ignorar este correo.</p>
      <p style="font-size:13px;color:#6b7280;word-break:break-all;">O copia este enlace: ${link}</p>`;
    await this.send(
      to,
      'Verifica tu correo - Orthodonca',
      this.layout('Verifica tu correo', body),
    );
  }

  async sendPasswordReset(to: string, link: string): Promise<void> {
    const body = `
      <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong>Orthodonca</strong>.</p>
      <p>Haz clic en el siguiente botón para crear una nueva contraseña. Este enlace caduca en 1 hora.</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${link}" style="background:#0f1f3d;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:9999px;display:inline-block;font-size:15px;">Restablecer contraseña</a>
      </p>
      <p style="font-size:13px;color:#6b7280;">Si no solicitaste este cambio, puedes ignorar este correo de forma segura.</p>
      <p style="font-size:13px;color:#6b7280;word-break:break-all;">O copia este enlace: ${link}</p>`;
    await this.send(
      to,
      'Restablece tu contraseña - Orthodonca',
      this.layout('Restablecer contraseña', body),
    );
  }

  async sendOrderShipped(
    to: string,
    order: MailOrder,
    trackingNumber?: string,
  ): Promise<void> {
    const tracking = trackingNumber
      ? `<p>Número de seguimiento: <strong>${trackingNumber}</strong></p>`
      : '';
    const body = `
      <p>¡Buenas noticias! Tu pedido <strong>#${order.id}</strong> ha sido enviado.</p>
      ${tracking}
      <p>Pronto recibirás tu compra. Gracias por elegir Orthodonca.</p>`;
    await this.send(
      to,
      `Tu pedido #${order.id} ha sido enviado - Orthodonca`,
      this.layout('Pedido enviado', body),
    );
  }
}
