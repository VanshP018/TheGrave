import { useMutation } from '@tanstack/react-query';
import type { AuthResponse } from '@thegrave/shared';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiRequestError } from '../lib/api';
import { useAuth } from '../stores/auth';
import { btnPrimary, card, Eyebrow, focusRing, GlowBackdrop, input, Wordmark } from './ui';

interface Field {
  name: string;
  label: string;
  type: string;
  autoComplete: string;
}

interface Props {
  title: string;
  submitLabel: string;
  fields: Field[];
  submit: (values: Record<string, string>) => Promise<AuthResponse>;
  footer: { text: string; linkText: string; to: string };
}

export function AuthForm({ title, submitLabel, fields, submit, footer }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const setSession = useAuth((s) => s.setSession);
  const navigate = useNavigate();
  const location = useLocation();
  // Back to where the user was headed, query string included (a room invite is /play?room=CODE).
  const target = (location.state as { from?: { pathname: string; search?: string } } | null)?.from;
  const from = target ? `${target.pathname}${target.search ?? ''}` : '/play';

  const mutation = useMutation({
    mutationFn: () => submit(values),
    onSuccess: (session) => {
      setSession(session);
      navigate(from, { replace: true });
    },
  });

  const err = mutation.error instanceof ApiRequestError ? mutation.error.body : null;
  const fieldError = (name: string) => err?.issues?.find((i) => i.path === name)?.message;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <main className="relative grid min-h-screen place-items-center px-4 py-16">
      <GlowBackdrop />
      <div className="relative w-full max-w-sm">
        <Wordmark size="lg" className="mb-8" />
        <form onSubmit={onSubmit} className={`${card} space-y-5 p-6 sm:p-8`} noValidate>
          <div>
            <Eyebrow>The arena</Eyebrow>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
          </div>

          {fields.map((f) => (
            <label key={f.name} className="block space-y-1.5">
              <span className="text-sm text-ash-300">{f.label}</span>
              <input
                name={f.name}
                type={f.type}
                autoComplete={f.autoComplete}
                required
                aria-invalid={!!fieldError(f.name)}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                className={`${input} aria-invalid:border-red-400`}
              />
              {fieldError(f.name) && (
                <span className="text-xs text-red-400">{fieldError(f.name)}</span>
              )}
            </label>
          ))}

          {mutation.isError && !err?.issues && (
            <p
              role="alert"
              className="rounded-sm border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-300"
            >
              {mutation.error instanceof ApiRequestError
                ? mutation.error.message
                : 'Could not reach the server'}
            </p>
          )}

          <button type="submit" disabled={mutation.isPending} className={`${btnPrimary} w-full`}>
            {mutation.isPending ? 'Please wait…' : submitLabel}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ash-300">
          {footer.text}{' '}
          <Link
            to={footer.to}
            state={location.state}
            className={`text-azure underline-offset-4 hover:underline ${focusRing}`}
          >
            {footer.linkText}
          </Link>
        </p>
      </div>
    </main>
  );
}
