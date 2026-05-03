import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UAParser } from 'ua-parser-js';
import { Request } from 'express';
import type { RequestMetadata } from '../interfaces/request-meta.interface';

export const RequestMeta = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): RequestMetadata => {
    const req = ctx.switchToHttp().getRequest<Request>();

    const meta = UAParser(req.headers['user-agent']);

    return {
      ip: req.ip!,
      browser: meta.browser,
      device: meta.device,
      raw: meta.ua,
      os: meta.os,
    };
  },
);
