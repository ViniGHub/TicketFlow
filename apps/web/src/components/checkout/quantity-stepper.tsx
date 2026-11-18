import { cn } from '../ui/cn';

interface QuantityStepperProps {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

const STEP_BUTTON =
  'flex size-9 items-center justify-center rounded-control border border-line text-lg ' +
  'hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand';

/** − quantidade +, entre 0 e `max`. O valor é anunciado aos leitores de tela a cada mudança. */
export function QuantityStepper({ label, value, max, onChange, disabled }: QuantityStepperProps) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={`Quantidade de ${label}`}>
      <button
        type="button"
        className={STEP_BUTTON}
        aria-label={`Menos um ${label}`}
        disabled={disabled || value <= 0}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <output
        aria-live="polite"
        className={cn('w-6 text-center tabular-nums', value > 0 && 'font-semibold')}
      >
        {value}
      </output>
      <button
        type="button"
        className={STEP_BUTTON}
        aria-label={`Mais um ${label}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}
