import { useMutation } from '@tanstack/react-query';
import type { AuthResponse } from '@thegrave/shared';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiRequestError } from '../lib/api';
import { useAuth } from '../stores/auth';

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
  const from =
    (useLocation().state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';

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
    <main className="min-h-screen grid place-items-center bg-zinc-950 px-4 text-zinc-100">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5" noValidate>
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400">
            theGrave
          </p>
          <h1 className="mt-1 text-2xl font-bold">{title}</h1>
        </div>

        {fields.map((f) => (
          <label key={f.name} className="block space-y-1">
            <span className="text-sm text-zinc-300">{f.label}</span>
            <input
              name={f.name}
              type={f.type}
              autoComplete={f.autoComplete}
              required
              value={values[f.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 outline-none focus:border-emerald-500"
            />
            {fieldError(f.name) && (
              <span className="text-xs text-red-400">{fieldError(f.name)}</span>
            )}
          </label>
        ))}

        {mutation.isError && !err?.issues && (
          <p role="alert" className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">
            {mutation.error instanceof ApiRequestError
              ? mutation.error.message
              : 'Could not reach the server'}
          </p>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full rounded-md bg-emerald-600 py-2 font-semibold hover:bg-emerald-500 disabled:opacity-50"
        >
          {mutation.isPending ? 'Please wait…' : submitLabel}
        </button>

        <p className="text-center text-sm text-zinc-400">
          {footer.text}{' '}
          <Link
            to={footer.to}
            state={useLocation().state}
            className="text-emerald-400 hover:underline"
          >
            {footer.linkText}
          </Link>
        </p>
      </form>
    </main>
  );
}
