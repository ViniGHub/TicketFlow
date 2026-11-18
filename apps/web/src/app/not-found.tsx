import Link from 'next/link';

import { buttonClasses } from '../components/ui/button';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-10">
      <h1 className="text-2xl font-bold">Página não encontrada</h1>
      <p className="text-muted">O endereço pode ter mudado, ou a página não existe mais.</p>
      <Link href="/" className={buttonClasses('secondary', 'self-start')}>
        Voltar ao início
      </Link>
    </div>
  );
}
