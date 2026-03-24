import { Injectable } from '@nestjs/common';
import { NotificationTemplateName } from '../types/notification.types';

type TemplateMap = Record<NotificationTemplateName, string>;

@Injectable()
export class NotificationTemplateService {
  private readonly templates: TemplateMap = {
    OTP_LOGIN: 'Your UniChat OTP is {{otpCode}}. Purpose: {{purpose}}.',
    OTP_REGISTER: 'Welcome to UniChat. Use OTP {{otpCode}} to complete registration.',
    WELCOME: 'Hi {{name}}, welcome to UniChat.',
    GENERIC_ALERT: '{{message}}',
  };

  render(
    templateName: NotificationTemplateName,
    variables: Record<string, string | number>,
  ): string {
    const template = this.templates[templateName] ?? this.templates.GENERIC_ALERT;
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const value = variables[key];
      return value === undefined ? '' : String(value);
    });
  }
}
