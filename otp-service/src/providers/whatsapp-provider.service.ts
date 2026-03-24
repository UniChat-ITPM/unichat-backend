import { Injectable, Logger } from '@nestjs/common';
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { NotificationProviderHealth } from '../types/notification.types';

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

    this.client = new Client({
      authStrategy: new LocalAuth({ clientId: 'otp-service' }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    });

    this.client.on('qr', (qr: string) => {
      this.logger.warn('WhatsApp login QR generated. Scan this terminal QR now.');
      qrcode.generate(qr, { small: true });
    });

    this.client.on('ready', () => {
      this.ready = true;
      this.connected = true;
      this.lastDisconnectReason = undefined;
      this.logger.log('WhatsApp session is ready');
    });

    this.client.on('authenticated', () => {
      this.connected = true;
      this.logger.log('WhatsApp session authenticated');
    });

    this.client.on('auth_failure', (message: string) => {
      this.ready = false;
      this.connected = false;
      this.lastDisconnectReason = message;
      this.logger.error(`WhatsApp auth failure: ${message}`);
    });

    this.client.on('disconnected', (reason: string) => {
      this.ready = false;
      this.connected = false;
      this.lastDisconnectReason = reason;
      this.logger.error(`WhatsApp disconnected: ${reason}`);
    });

    try {
      await this.client.initialize();
    } catch (error) {
      this.ready = false;
      this.connected = false;
      this.lastDisconnectReason =
        error instanceof Error ? error.message : 'Initialization failed';
      this.logger.error(`Failed to initialize WhatsApp: ${this.lastDisconnectReason}`);
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
