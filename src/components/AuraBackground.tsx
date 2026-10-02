// Сплошной фон — без кругов и радиальных градиентов.
import { EngineStatus } from '../types';

interface AuraBackgroundProps {
  status: EngineStatus;
}

export function AuraBackground({ status }: AuraBackgroundProps) {
  void status;

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 bg-[#07080c]" />
  );
}
