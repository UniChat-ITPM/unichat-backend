export enum NotificationChannel {
  WHATSAPP = 'WHATSAPP',
  SMS = 'SMS',
  PUSH = 'PUSH',
}

export type NotificationTemplateName =
  | 'OTP_LOGIN'
  | 'OTP_REGISTER'
  | 'WELCOME'
  | 'GENERIC_ALERT';

export type NotificationRequest = {
  phoneNumber: string;
  template: NotificationTemplateName;
  variables?: Record<string, string | number>;
  channel: NotificationChannel;
  maxRetries?: number;
  userId?: string;
  templateName?: string;
};

export type OtpSendRequest = {
  phoneNumber: string;
  otpCode: string;
  purpose?: string;
  channel?: NotificationChannel;
  userId?: string;
  maxRetries?: number;
};

export type NotificationSendResult = {
  status: 'sent' | 'failed' | 'retrying';
  reason?: string;
  providerMessageId?: string;
};

export type NotificationProviderHealth = {
  provider: string;
  ready: boolean;
  connected: boolean;
  lastDisconnectReason?: string;
};
