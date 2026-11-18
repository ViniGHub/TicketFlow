import { Spinner } from '../components/ui/spinner';

/** Enquanto uma página carrega (Suspense do App Router). */
export default function Loading() {
  return (
    <div className="flex justify-center py-20 text-muted">
      <Spinner label="Carregando a página" className="scale-150" />
    </div>
  );
}
