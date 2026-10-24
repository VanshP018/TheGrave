import { useMutation } from '@tanstack/react-query';
import type { RegisterStartResponse } from '@thegrave/shared';
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiRequestError, authApi } from '../lib/api';
import { useAuth } from '../stores/auth';
import {
  btnPrimary,
  btnSecondary,
  card,
  Eyebrow,
  focusRing,
  GlowBackdrop,
  input,
  Wordmark,
} from './ui';

// Two-step registration (decision.md D-076): details, then the 6-digit code emailed to the address.
const FIELDS = [
  { name: 'username', label: 'Username', type: 'text', autoComplete: 'username' },
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  {
    name: 'institution',
    label: 'School / College',
    type: 'text',
    autoComplete: 'organization',
    placeholder: 'e.g. IIT Delhi',
  },
  { name: 'password', label: 'Password', type: 'password', autoComplete: 'new-password' },
] as const;

const CODE_LENGTH = 6;
const emptyDigits = () => Array<string>(CODE_LENGTH).fill('');

const formatCountdown = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function RegisterForm() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [started, setStarted] = useState<RegisterStartResponse | null>(null);
  const [digits, setDigits] = useState<string[]>(emptyDigits);
  const [now, setNow] = useState(() => Date.now());
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const setSession = useAuth((s) => s.setSession);
  const navigate = useNavigate();
  const location = useLocation();
  // Back to where the user was headed, query string included (a room invite is /play?room=CODE).
  const target = (location.state as { from?: { pathname: string; search?: string } } | null)?.from;
  const from = target ? `${target.pathname}${target.search ?? ''}` : '/play';

  const start = useMutation({
    mutationFn: () => authApi.register(values),
    onSuccess: (res) => {
      setStarted(res);
      setNow(Date.now());
      setDigits(emptyDigits());
    },
  });
  const verify = useMutation({
    mutationFn: (code: string) => authApi.verifyEmail({ email: started!.email, code }),
    onSuccess: (session) => {
      setSession(session);
      navigate(from, { replace: true });
    },
    onError: () => {
      setDigits(emptyDigits());
      boxes.current[0]?.focus();
    },
  });
  const resend = useMutation({
    mutationFn: () => authApi.resendCode({ email: started!.email }),
    onSuccess: (res) => {
      setStarted(res);
      setNow(Date.now());
      setDigits(emptyDigits());
      verify.reset();
      boxes.current[0]?.focus();
    },
  });

  // Live "Resend in 0:42" countdown.
  useEffect(() => {
    if (!started) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [started]);

  useEffect(() => {
    if (started) boxes.current[0]?.focus();
  }, [started]);

  const startErr = start.error instanceof ApiRequestError ? start.error.body : null;
  const fieldError = (name: string) => startErr?.issues?.find((i) => i.path === name)?.message;
  const verifyErr = verify.error instanceof ApiRequestError ? verify.error.body : null;
  const resendErr = resend.error instanceof ApiRequestError ? resend.error.body : null;

  const submitCode = (list: string[]) => {
    const code = list.join('');
    if (code.length === CODE_LENGTH && !verify.isPending) verify.mutate(code);
  };

  const setDigit = (i: number, raw: string) => {
    const digit = raw.replace(/\D/g, '').slice(-1);
    const next = digits.map((d, idx) => (idx === i ? digit : d));
    setDigits(next);
    if (digit && i < CODE_LENGTH - 1) boxes.current[i + 1]?.focus();
    if (digit) submitCode(next);
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      e.preventDefault();
      setDigits((d) => d.map((v, idx) => (idx === i - 1 ? '' : v)));
      boxes.current[i - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && i > 0) boxes.current[i - 1]?.focus();
    else if (e.key === 'ArrowRight' && i < CODE_LENGTH - 1) boxes.current[i + 1]?.focus();
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (!pasted) return;
    e.preventDefault();
    const next = emptyDigits().map((_, i) => pasted[i] ?? '');
    setDigits(next);
    boxes.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
    submitCode(next);
  };

  const backToDetails = () => {
    setStarted(null);
    start.reset();
    verify.reset();
    resend.reset();
  };

  const onSubmitDetails = (e: FormEvent) => {
    e.preventDefault();
    start.mutate();
  };
  const onSubmitCode = (e: FormEvent) => {
    e.preventDefault();
    submitCode(digits);
  };

  const dead =
    verifyErr &&
    (verifyErr.attemptsLeft === 0 || verifyErr.message === 'Code expired or not found');
  const remaining = started ? started.resendAvailableAt - now : 0;
  const alertClass =
    'rounded-sm border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-300';

  return (
    <main className="relative grid min-h-screen place-items-center px-4 py-16">
      <GlowBackdrop />
      <div className="relative w-full max-w-sm">
        <Wordmark className="mb-8 inline-block text-xl" />

        {!started ? (
          <form
            key="details"
            onSubmit={onSubmitDetails}
            className={`${card} step-in space-y-5 p-6 sm:p-8`}
            noValidate
          >
            <div>
              <Eyebrow>The arena</Eyebrow>
              <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Create an account</h1>
            </div>

            {FIELDS.map((f) => (
              <label key={f.name} className="block space-y-1.5">
                <span className="text-sm text-ash-300">{f.label}</span>
                <input
                  name={f.name}
                  type={f.type}
                  autoComplete={f.autoComplete}
                  placeholder={'placeholder' in f ? f.placeholder : undefined}
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

            {start.isError && !startErr?.issues && (
              <p role="alert" className={alertClass}>
                {start.error instanceof ApiRequestError
                  ? start.error.message
                  : 'Could not reach the server'}
              </p>
            )}

            <button type="submit" disabled={start.isPending} className={`${btnPrimary} w-full`}>
              {start.isPending ? 'Please wait…' : 'Register'}
            </button>
          </form>
        ) : (
          <form
            key="code"
            onSubmit={onSubmitCode}
            className={`${card} step-in space-y-5 p-6 sm:p-8`}
            noValidate
          >
            <div>
              <Eyebrow>Verify your email</Eyebrow>
              <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Check your email</h1>
              <p className="mt-2 text-sm text-ash-300">
                We sent a 6-digit code to
                <span className="mt-0.5 block break-words text-ink">{started.email}</span>
              </p>
            </div>

            <div role="group" aria-label="Verification code" className="flex justify-between gap-2">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    boxes.current[i] = el;
                  }}
                  aria-label={`Digit ${i + 1}`}
                  aria-invalid={!!verifyErr}
                  inputMode="numeric"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  maxLength={1}
                  value={d}
                  disabled={verify.isPending}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => onKeyDown(i, e)}
                  onPaste={onPaste}
                  onFocus={(e) => e.currentTarget.select()}
                  className={`${input} aspect-square min-w-0 px-0 text-center font-mono text-xl aria-invalid:border-red-400`}
                />
              ))}
            </div>

            {verifyErr && (
              <p role="alert" className={alertClass}>
                {verifyErr.attemptsLeft === 0
                  ? 'Too many incorrect codes. Start again to get a new one.'
                  : verifyErr.attemptsLeft !== undefined
                    ? `Incorrect code. ${verifyErr.attemptsLeft} ${verifyErr.attemptsLeft === 1 ? 'attempt' : 'attempts'} left.`
                    : verifyErr.message === 'Code expired or not found'
                      ? 'This code expired. Start again to get a new one.'
                      : verifyErr.message}
              </p>
            )}
            {verify.isError && !verifyErr && (
              <p role="alert" className={alertClass}>
                Could not reach the server
              </p>
            )}

            {dead ? (
              <button type="button" onClick={backToDetails} className={`${btnPrimary} w-full`}>
                Start again
              </button>
            ) : (
              <button
                type="submit"
                disabled={verify.isPending || digits.some((d) => !d)}
                className={`${btnPrimary} w-full`}
              >
                {verify.isPending ? 'Verifying…' : 'Verify'}
              </button>
            )}

            {!dead && (
              <div className="space-y-3 text-center text-sm">
                <button
                  type="button"
                  onClick={() => resend.mutate()}
                  disabled={remaining > 0 || resend.isPending}
                  className={`${btnSecondary} w-full`}
                >
                  {remaining > 0 ? `Resend in ${formatCountdown(remaining)}` : 'Resend code'}
                </button>
                {resendErr && (
                  <p role="alert" className="text-xs text-red-400">
                    {resendErr.message}
                  </p>
                )}
                <button
                  type="button"
                  onClick={backToDetails}
                  className={`text-azure underline-offset-4 hover:underline ${focusRing}`}
                >
                  Use a different email
                </button>
              </div>
            )}
          </form>
        )}

        <p className="mt-6 text-center text-sm text-ash-300">
          Already have an account?{' '}
          <Link
            to="/login"
            state={location.state}
            className={`text-azure underline-offset-4 hover:underline ${focusRing}`}
          >
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
