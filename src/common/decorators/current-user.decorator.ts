import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../interfaces/auth-user.interface';
import { Request } from 'express';

export const CurrentUser = createParamDecorator(
  (
    data: keyof AuthenticatedUser,
    ctx: ExecutionContext,
  ): AuthenticatedUser | AuthenticatedUser[keyof AuthenticatedUser] => {
    const request = ctx.switchToHttp().getRequest<Request>();

    const user = request.user!;

    return data ? user?.[data] : user;
  },
);
