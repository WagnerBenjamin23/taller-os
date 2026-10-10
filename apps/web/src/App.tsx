import { useState } from 'react';
import { healthResponseSchema } from '@talleros/contracts';
import { appConfig } from './config';
import { AuthPanel } from './auth/AuthPanel';
export function App() {
  const [result, setResult] = useState('Sin verificar.');
  const [pending, setPending] = useState(false);
  async function checkApi() {
    setPending(true);
    setResult('Verificando…');
    try {
      const response = await fetch('/api/v1/health', { cache: 'no-store' });
      if (!response.ok) throw new Error('API no disponible');
      healthResponseSchema.parse(await response.json());
      setResult('API disponible. Esta prueba no verifica Supabase ni R2.');
    } catch {
      setResult('No se pudo verificar la API. Revisá que el Worker esté iniciado.');
    } finally {
      setPending(false);
    }
  }
  return (
    <main>
      <p className="eyebrow">FASE 2 · IDENTIDAD Y ACCESO</p>
      <h1>{appConfig.name}</h1>
      <p>
        Base de desarrollo. Autenticación y acceso en validación; las funciones del taller todavía
        no están implementadas.
      </p>
      <button
        type="button"
        onClick={() => {
          void checkApi();
        }}
        disabled={pending}
      >
        {pending ? 'Verificando…' : 'Verificar API'}
      </button>
      <AuthPanel />
      <p role="status" aria-live="polite">
        {result}
      </p>
    </main>
  );
}
