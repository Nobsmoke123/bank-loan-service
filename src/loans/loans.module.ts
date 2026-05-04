import { Module } from '@nestjs/common';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { KeyvCacheableMemory } from 'cacheable';
import { Keyv } from 'keyv';
import KeyvRedis from '@keyv/redis';
import Redis from 'ioredis';

@Module({
  imports: [
    PrismaModule,
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        ttl: Number(configService.get<string>('REDIS_TTL')!),
        stores: [
          new Keyv({
            store: new KeyvCacheableMemory({
              ttl: Number(configService.get<string>('REDIS_TTL')!),
              lruSize: Number(configService.get<string>('REDIS_LRU_SIZE')!),
            }),
          }),

          new KeyvRedis(configService.get<string>('REDIS_URL')),
        ],
      }),
    }),
  ],
  providers: [
    LoansService,
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        return new Redis(configService.get<string>('REDIS_URL')!);
      },
      inject: [ConfigService],
    },
  ],
  controllers: [LoansController],
})
export class LoansModule {}
