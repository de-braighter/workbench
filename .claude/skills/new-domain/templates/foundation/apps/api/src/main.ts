import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env['PORT'] ?? {{HTTP_PORT}});
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`{{DOMAIN}}-api listening on http://localhost:${port}`);
}

void bootstrap();
