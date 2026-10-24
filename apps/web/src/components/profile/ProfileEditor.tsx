import {
  BIO_MAX,
  profileUpdateSchema,
  SOCIAL_KEYS,
  type ProfileView,
  type SocialKey,
} from '@thegrave/shared';
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
  type SVGProps,
} from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { GitHubIcon, GlobeIcon, LinkedInIcon, XIcon } from '../play/icons';
import { btnPrimary, btnSecondary, focusRing } from '../ui';

export const SOCIAL: Record<
  SocialKey,
  { label: string; icon: ComponentType<SVGProps<SVGSVGElement>>; placeholder: string }
> = {
  github: { label: 'GitHub', icon: GitHubIcon, placeholder: 'https://github.com/you' },
  linkedin: { label: 'LinkedIn', icon: LinkedInIcon, placeholder: 'https://linkedin.com/in/you' },
  x: { label: 'X', icon: XIcon, placeholder: 'https://x.com/you' },
  website: { label: 'Website', icon: GlobeIcon, placeholder: 'https://you.dev' },
};

/** Slide-over to edit your bio and links (decision.md D-071), validated with the server's own schema. */
export function ProfileEditor(props: {
  profile: ProfileView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile, onClose, onSaved } = props;
  const [bio, setBio] = useState(profile.bio ?? '');
  const [links, setLinks] = useState<Record<SocialKey, string>>(
    Object.fromEntries(SOCIAL_KEYS.map((k) => [k, profile.links[k] ?? ''])) as Record<
      SocialKey,
      string
    >,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const parsed = profileUpdateSchema.safeParse({ bio, links });
  const fieldError = (k: SocialKey) =>
    parsed.success
      ? null
      : (parsed.error.issues.find((i) => i.path[0] === 'links' && i.path[1] === k)?.message ??
        null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.success) return;
    setSaving(true);
    setError(null);
    try {
      await api('/me/profile', { method: 'PATCH', json: parsed.data });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save, try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Edit profile">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />
      <form
        onSubmit={save}
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-gradient-to-b from-[#121212] to-[#080808] px-6 py-8 shadow-[-30px_0_80px_-20px_rgb(0_0_0)] sm:px-8"
      >
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-azure">Profile</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Edit your profile</h2>

        <label className="mt-8 block">
          <span className="flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-[0.2em] text-ash-400">
            Bio
            <span
              className={`font-mono tracking-normal ${bio.length > BIO_MAX ? 'text-red-400' : ''}`}
            >
              {bio.length}/{BIO_MAX}
            </span>
          </span>
          <textarea
            ref={first}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            placeholder="What do you build? What do you break?"
            className={`mt-2 w-full resize-none rounded-lg bg-white/[0.04] px-4 py-3 text-[15px] leading-relaxed text-ink placeholder:text-ash-600 ${focusRing}`}
          />
        </label>

        <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.2em] text-ash-400">
          Links
        </p>
        <div className="mt-3 space-y-3">
          {SOCIAL_KEYS.map((k) => {
            const { label, icon: Icon, placeholder } = SOCIAL[k];
            const err = links[k] ? fieldError(k) : null;
            return (
              <label key={k} className="block">
                <span className="sr-only">{label}</span>
                <span
                  className={`flex items-center gap-3 rounded-lg bg-white/[0.04] px-4 transition-shadow focus-within:shadow-[inset_0_0_0_1px_rgb(92_184_255/0.6)] ${err ? 'shadow-[inset_0_0_0_1px_rgb(248_113_113/0.6)]' : ''}`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-ash-400" />
                  <input
                    value={links[k]}
                    onChange={(e) => setLinks({ ...links, [k]: e.target.value })}
                    placeholder={placeholder}
                    aria-label={label}
                    aria-invalid={!!err}
                    inputMode="url"
                    autoComplete="url"
                    spellCheck={false}
                    className="h-11 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ash-600"
                  />
                </span>
                {err && <span className="mt-1 block text-xs text-red-400">{err}</span>}
              </label>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-ash-400">
          Links must be https. Leave a field empty to remove it.
        </p>

        {error && (
          <p className="mt-4 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <div className="mt-auto flex gap-3 pt-10">
          <button
            type="submit"
            disabled={!parsed.success || saving}
            className={`${btnPrimary} flex-1 rounded-md`}
          >
            {saving ? 'Saving…' : 'Save profile'}
          </button>
          <button type="button" onClick={onClose} className={`${btnSecondary} rounded-md`}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
