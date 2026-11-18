import { type Metadata } from 'next';
import { Suspense } from 'react';

import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Entrar' };

export default function LoginPage() {
  // Suspense: o formulário lê o `next` da query (useSearchParams).
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
