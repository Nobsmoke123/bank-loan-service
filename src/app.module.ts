import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { UsersModule } from './users/users.module';
import { LoansModule } from './loans/loans.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AppjwtModule } from './appjwt/appjwt.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    CommonModule,
    UsersModule,
    LoansModule,
    PrismaModule,
    AppjwtModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
