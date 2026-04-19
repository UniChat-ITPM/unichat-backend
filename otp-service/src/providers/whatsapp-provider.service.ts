import { Injectable, Logger } from '@nestjs/common';
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { NotificationProviderHealth } from '../types/notification.types';

/** Puppeteer can throw when WhatsApp Web navigates while wwebjs runs page.evaluate (race). */
function isTransientInitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('execution context was destroyed') ||
    m.includes('protocol error') ||
    m.includes('target closed') ||
    m.includes('session closed') ||
    m.includes('navigation timeout') ||
    m.includes('net::err_')
  );
}

@Injectable()
export class WhatsappProviderService {
  private readonly logger = new Logger(WhatsappProviderService.name);
  private client: Client | null = null;
  private ready = false;
  private connected = false;
  private lastDisconnectReason?: string;

  async initialize(): Promise<void> {
    if (this.client) {
      return;
    }

    const maxAttempts = Math.max(
      1,
      Number(process.env['WHATSAPP_INIT_MAX_ATTEMPTS'] ?? 4),
    );
    const retryBaseMs = Math.max(
      500,
      Number(process.env['WHATSAPP_INIT_RETRY_BASE_MS'] ?? 2000),
    );

    const puppeteerOptions = {
      headless: true,
      defaultViewport: null,
      ...(process.env['WHATSAPP_PUPPETEER_EXECUTABLE_PATH']
        ? {
            executablePath: process.env['WHATSAPP_PUPPETEER_EXECUTABLE_PATH'],
          }
        : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--no-first-run',
        '--disable-extensions',
      ],
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const client = new Client({
        authStrategy: new LocalAuth({ clientId: 'otp-service' }),
        /** Extra time for slow loads; wwebjs treats 0 as 30000ms internally for inject polling. */
        authTimeoutMs: Number(process.env['WHATSAPP_AUTH_TIMEOUT_MS'] ?? 90000),
        puppeteer: puppeteerOptions,
      });

      this.registerClientHandlers(client);

      try {
        this.client = client;
        await client.initialize();
        return;
      } catch (error) {
        await this.destroyClientQuietly(client);
        this.client = null;
        this.ready = false;
        this.connected = false;

        const msg =
          error instanceof Error ? error.message : 'Initialization failed';

        if (!isTransientInitError(msg) || attempt === maxAttempts) {
          this.lastDisconnectReason = msg;
          this.logger.error(
            `Failed to initialize WhatsApp (attempt ${attempt}/${maxAttempts}): ${msg}`,
          );
          return;
        }

        const delayMs = Math.min(30_000, retryBaseMs * 2 ** (attempt - 1));
        this.logger.warn(
          `WhatsApp init hit a transient browser error; retrying in ${delayMs}ms… (${msg})`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  private registerClientHandlers(client: Client): void {
    client.on('qr', (qr: string) => {
      this.logger.warn('WhatsApp login QR generated. Scan this terminal QR now.');
      qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
      this.ready = true;
      this.connected = true;
      this.lastDisconnectReason = undefined;
      this.logger.log('WhatsApp session is ready');
    });

    client.on('authenticated', () => {
      this.connected = true;
      this.logger.log('WhatsApp session authenticated');
    });

    client.on('auth_failure', (message: string) => {
      this.ready = false;
      this.connected = false;
      this.lastDisconnectReason = message;
      this.logger.error(`WhatsApp auth failure: ${message}`);
    });

    client.on('disconnected', (reason: string) => {
      this.ready = false;
      this.connected = false;
      this.lastDisconnectReason = reason;
      this.logger.error(`WhatsApp disconnected: ${reason}`);
    });
  }

  private async destroyClientQuietly(client: Client): Promise<void> {
    try {
      await client.destroy();
    } catch {
      // Best-effort cleanup after a failed init.
    }
  }

  async sendMessage(phoneNumber: string, message: string): Promise<string> {
    if (!this.client || !this.ready) {
      throw new Error('WhatsApp client is not ready');
    }

    const chatId = this.toWhatsappChatId(phoneNumber);
    const response = await this.client.sendMessage(chatId, message);
    return response.id._serialized;
  }

  async isWhatsappUser(phoneNumber: string): Promise<boolean> {
    if (!this.client || !this.ready) {
      throw new Error('WhatsApp client is not ready');
    }

    const chatId = this.toWhatsappChatId(phoneNumber);
    const numberInfo = await this.client.getNumberId(chatId);
    return Boolean(numberInfo?.user);
  }

  getHealth(): NotificationProviderHealth {
    return {
      provider: 'whatsapp-web.js',
      ready: this.ready,
      connected: this.connected,
      lastDisconnectReason: this.lastDisconnectReason,
    };
  }

  async shutdown(): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.destroy();
    this.client = null;
    this.ready = false;
    this.connected = false;
  }

  private toWhatsappChatId(phoneNumber: string): string {
    const normalized = phoneNumber.replace(/\D/g, '');
    return `${normalized}@c.us`;
  }
}
