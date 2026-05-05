import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import * as cors from 'cors';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  if (configService.get<string>('NODE_ENV')! === 'production') {
    app.set('trust proxy', 1);
  } else {
    app.set('trust proxy', false);
  }

  app.use(cookieParser(configService.get<string>('COOKIE_PARSER_SECRET')!));

  app.use(helmet());

  app.use(
    cors({
      credentials: true,
      origin: ['http://localhost:3001'],
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      whitelist: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  await app.listen(configService.get<number>('PORT')!);
}
bootstrap()
  .then(() => {})
  .catch((err) => console.log(err));
