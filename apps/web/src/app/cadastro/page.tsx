import { type Metadata } from 'next';
import { Suspense } from 'react';

import { RegisterForm } from './register-form';

export const metadata: Metadata = { title: 'Criar conta' };

export default function RegisterPage() {
  // Suspense: o formulário lê o `next` da query (useSearchParams).
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
