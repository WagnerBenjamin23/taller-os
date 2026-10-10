import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  getSession: vi.fn(),
  signUp: vi.fn(),
  signIn: vi.fn(),
  reset: vi.fn(),
  exchange: vi.fn(),
  signOut: vi.fn(),
  update: vi.fn(),
  callback: null as null | ((event: string, session: unknown) => void),
}));
vi.mock('./client', () => ({
  authClient: {
    auth: {
      getSession: mock.getSession,
      signUp: mock.signUp,
      signInWithPassword: mock.signIn,
      resetPasswordForEmail: mock.reset,
      exchangeCodeForSession: mock.exchange,
      signOut: mock.signOut,
      updateUser: mock.update,
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        mock.callback = callback;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  },
}));
import { AuthPanel } from './AuthPanel';
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
  mock.callback = null;
  mock.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mock.signUp.mockResolvedValue({ error: null });
  mock.signIn.mockResolvedValue({ error: { message: 'internal detail' } });
  mock.reset.mockResolvedValue({ error: null });
  mock.exchange.mockResolvedValue({ error: null });
  mock.signOut.mockResolvedValue({ error: null });
  mock.update.mockResolvedValue({ error: null });
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(new Response('[]', { headers: { 'Content-Type': 'application/json' } })),
  );
});
describe('Auth UI mínima, no tests RLS', () => {
  it('un cierre externo seguido de otra identidad no conserva recuperación', async () => {
    render(<AuthPanel />);
    await screen.findByRole('button', { name: 'Crear cuenta' });
    await act(async () => {
      mock.callback?.('PASSWORD_RECOVERY', { access_token: 'test-only', user: { id: 'first' } });
    });
    expect(screen.getByRole('button', { name: 'Actualizar contraseña' })).toBeInTheDocument();
    await act(async () => {
      mock.callback?.('SIGNED_OUT', null);
      mock.callback?.('SIGNED_IN', { access_token: 'test-only', user: { id: 'second' } });
    });
    expect(screen.queryByRole('button', { name: 'Actualizar contraseña' })).not.toBeInTheDocument();
    expect(screen.getByText('Mis talleres')).toBeInTheDocument();
  });
  it('registro usa confirmación de email sin entrar a un taller falso', async () => {
    render(<AuthPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Crear cuenta' }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Benjamín' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'Password-test-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Registrarme' }));
    expect(
      await screen.findByText('Revisá tu correo para confirmar la cuenta.'),
    ).toBeInTheDocument();
    expect(mock.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: expect.stringMatching(/\/auth\/callback$/),
        }),
      }),
    );
    expect(screen.queryByText('Mis talleres')).not.toBeInTheDocument();
  });
  it('login fallido no expone detalles de Auth', async () => {
    render(<AuthPanel />);
    await screen.findByRole('button', { name: 'Crear cuenta' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Ingresar' })[1]!);
    expect(await screen.findByText(/No se pudo iniciar sesión/)).not.toHaveTextContent(
      'internal detail',
    );
  });
  it('recuperación presenta respuesta neutral y redirect permitido', async () => {
    render(<AuthPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Recuperar contraseña' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar recuperación' }));
    expect(await screen.findByText(/Si existe una cuenta/)).toBeInTheDocument();
    expect(mock.reset).toHaveBeenCalledWith('user@example.test', {
      redirectTo: expect.stringMatching(/\/reset-password$/),
    });
  });
  it('PKCE se intercambia una sola vez incluso en StrictMode y limpia el código', async () => {
    window.history.replaceState({}, '', '/auth/callback?code=one-time-code');
    render(
      <StrictMode>
        <AuthPanel />
      </StrictMode>,
    );
    await waitFor(() => expect(mock.exchange).toHaveBeenCalledTimes(1));
    expect(window.location.search).toBe('');
    await screen.findByRole('button', { name: 'Crear cuenta' });
  });
  it('la ruta de recuperación sola no concede permiso de cambio de contraseña', async () => {
    window.history.replaceState({}, '', '/reset-password');
    render(<AuthPanel />);
    await screen.findByRole('button', { name: 'Crear cuenta' });
    expect(screen.queryByRole('button', { name: 'Actualizar contraseña' })).not.toBeInTheDocument();
    expect(mock.update).not.toHaveBeenCalled();
  });
  it('PASSWORD_RECOVERY habilita el formulario sólo con sesión y logout lo elimina', async () => {
    render(<AuthPanel />);
    await screen.findByRole('button', { name: 'Crear cuenta' });
    await act(async () => {
      mock.callback?.('PASSWORD_RECOVERY', {
        access_token: 'test-only',
        user: { id: '11111111-1111-4111-8111-111111111111', email: 'user@example.test' },
      });
    });
    expect(screen.getByRole('button', { name: 'Actualizar contraseña' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await screen.findByRole('button', { name: 'Crear cuenta' });
    expect(screen.queryByRole('button', { name: 'Actualizar contraseña' })).not.toBeInTheDocument();
  });
});
