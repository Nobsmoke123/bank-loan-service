import { Module } from '@nestjs/common';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { KeyvCacheableMemory } from 'cacheable';
import { Keyv } from 'keyv';
import KeyvRedis from '@keyv/redis';

@Module({
  imports: [
    PrismaModule,
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        ttl: configService.get<number>('REDIS_TTL')!,
        stores: [
          new Keyv({
            store: new KeyvCacheableMemory({
              lruSize: configService.get<number>('REDIS_LRU_SIZE')!,
            }),
          }),

          new KeyvRedis(configService.get<string>('REDIS_URL')!),
        ],
      }),
    }),
  ],
  providers: [LoansService],
  controllers: [LoansController],
})
export class LoansModule {}
