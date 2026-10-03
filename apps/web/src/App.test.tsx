import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
describe('verificación técnica', () => {
  it('explica alcance y confirma el contrato real de API', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ status: 'ok', service: 'talleros-api', version: '0.1.0', phase: 1 }),
          ),
        ),
    );
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('TallerOS');
    fireEvent.click(screen.getByRole('button', { name: 'Verificar API' }));
    expect(await screen.findByText(/API disponible/)).toHaveTextContent(
      'no verifica Supabase ni R2',
    );
  });
  it('no da éxito ante HTML o respuesta que no cumple el contrato', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>SPA fallback</html>')));
    render(<App />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText(/No se pudo verificar/)).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeEnabled();
  });
  it('muestra el fallo de red sin exponer detalles internos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private host')));
    render(<App />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText(/No se pudo verificar/)).not.toHaveTextContent('private host');
  });
});
