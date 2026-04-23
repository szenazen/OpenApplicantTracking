import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadEnv } from './config/env.config';

async function bootstrap() {
  loadEnv();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const port = Number(process.env.ACCOUNT_SERVICE_PORT ?? 3010);

  app.enableCors({ origin: true, credentials: true });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(port);
  new Logger('bootstrap').log(`account-service listening on :${port}`);
}

void bootstrap();
