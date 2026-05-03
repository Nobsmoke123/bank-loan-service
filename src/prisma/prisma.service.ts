import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

@Injectable()
export class PrismaService extends PrismaClient {
  constructor(configService: ConfigService) {
    const adapter = new PrismaPg({
      connectionString:
        configService.get<string>('NODE_ENV') === 'test'
          ? configService.get<string>('TEST_DATABASE_URL')!
          : configService.get<string>('DIRECT_DATABASE_URL')!,
    });

    super({ adapter });
  }
}
