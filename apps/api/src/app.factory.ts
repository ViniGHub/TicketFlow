import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { ACCESS_COOKIE } from './auth/session';
import { type ApiEnv } from './config/env';

function setupSwagger(app: NestExpressApplication): void {
  const config = new DocumentBuilder()
    .setTitle('TicketFlow API')
    .setDescription(
      'Venda de ingressos com Stripe Checkout. A sessão fica em cookies httpOnly: faça login ' +
        'em /auth/login e as próximas chamadas pelo Swagger já vão autenticadas.',
    )
    .setVersion('0.1.0')
    .addCookieAuth(ACCESS_COOKIE)
    .build();
  const document = SwaggerModule.createDocument(app, config);
  // /docs (interface) e /docs-json (usado para gerar os tipos do front, etapa 6.1).
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
}

/** Cria a API configurada. Usada pelo main.ts e pelos testes de integração. */
export async function createApp(env: ApiEnv): Promise<NestExpressApplication> {
  // Adapter importado estaticamente: sem isso o Nest carrega o Express sob demanda e o
  // carregamento a frio estoura o timeout dos testes com a máquina sob carga.
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register(env),
    new ExpressAdapter(),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));

  if (env.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }
  app.use(helmet());
  app.use(cookieParser());
  // Front e API no mesmo site via BFF (seção 10); o CORS cobre o acesso direto em dev.
  app.enableCors({ origin: new URL(env.APP_URL).origin, credentials: true });
  app.enableShutdownHooks();
  setupSwagger(app);

  return app;
}
