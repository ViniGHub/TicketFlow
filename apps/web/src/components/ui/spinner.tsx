import { cn } from './cn';

/** Indicador de carregamento. Com `label`, os leitores de tela anunciam o que está carregando. */
export function Spinner({
  label = 'Carregando',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span role="status" aria-label={label} className={cn('inline-flex', className)}>
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
    </span>
  );
}
