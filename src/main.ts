import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));

  // enable CORS for the React frontend
  await app.register(require('@fastify/cors'), {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // swagger setup
  const config = new DocumentBuilder()
    .setTitle('Dilamme Scheduler API')
    .setDescription('Background job scheduler with heap-based priority queue, DAG workflows, and dead-letter queue')
    .setVersion('1.0')
    .addTag('jobs', 'Job management endpoints')
    .addTag('events', 'Server-sent events for live updates')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
   
  await app.listen({
    port: Number(process.env.PORT!) || 3000,
    host: '0.0.0.0'
  });
}

void bootstrap();
