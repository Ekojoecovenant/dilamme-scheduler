import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
   
  await app.listen({
    port: Number(process.env.PORT!) || 3000,
    host: '0.0.0.0'
  });
}

void bootstrap();
