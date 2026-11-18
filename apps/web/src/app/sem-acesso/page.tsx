import { type Metadata } from 'next';
import Link from 'next/link';

import { buttonClasses } from '../../components/ui/button';

export const metadata: Metadata = { title: 'Sem acesso' };

/** Para onde o proxy manda quem está logado, mas não tem o papel que a página exige. */
export default function ForbiddenPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-10">
      <h1 className="text-2xl font-bold">Esta área não é para a sua conta</h1>
      <p className="text-muted">
        A área do organizador é para quem cria e vende eventos. Para isso, crie uma conta de
        organizador.
      </p>
      <Link href="/" className={buttonClasses('secondary', 'self-start')}>
        Voltar ao início
      </Link>
    </div>
  );
}
