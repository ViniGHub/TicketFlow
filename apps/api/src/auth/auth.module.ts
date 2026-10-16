import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { type ApiEnv } from '../config/env';
import { API_ENV } from '../config/env.token';

import { AuthController, MeController } from './auth.controller';
import { JwtAuthGuard, RolesGuard } from './auth.guards';
import { AuthService } from './auth.service';
import { PasswordHasher } from './password-hasher';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => ({
        secret: env.JWT_SECRET,
        signOptions: { algorithm: 'HS256' },
        // Fixar o algoritmo impede a troca para `none` ou outro algoritmo no token recebido.
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController, MeController],
  providers: [AuthService, PasswordHasher, JwtAuthGuard, RolesGuard],
  exports: [JwtAuthGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
