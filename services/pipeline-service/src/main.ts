import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const port = Number(process.env.PIPELINE_SERVICE_PORT ?? 3030);

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
  new Logger('bootstrap').log(`pipeline-service listening on :${port}`);
}

void bootstrap();
