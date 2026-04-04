import { All, Controller, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { BackendProxyService } from './backend-proxy.service';

@Controller()
export class ConversationsProxyController {
  constructor(private readonly backendProxy: BackendProxyService) {}

  @All(['conversations', 'conversations/*'])
  async proxy(@Req() req: Request, @Res() res: Response) {
    const { status, data } = await this.backendProxy.forward(
      'conversation',
      req,
    );
    res.status(status).send(data);
  }
}
