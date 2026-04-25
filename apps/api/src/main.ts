import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const port = Number(process.env.API_PORT ?? 3001);
  const corsOrigins = (process.env.CORS_ORIGINS ??
    'http://localhost:3002,http://localhost:3000')
    .split(',')
    .map((o) => o.trim());

  app.enableCors({ origin: corsOrigins, credentials: true });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useWebSocketAdapter(new IoAdapter(app));

  const openapi = new DocumentBuilder()
    .setTitle('OpenApplicantTracking API')
    .setDescription('Multi-tenant, multi-region ATS — REST API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, openapi));

  await app.listen(port);
  new Logger('bootstrap').log(`OAT API listening on :${port}`);
}

void bootstrap();
