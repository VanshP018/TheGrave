import { z } from 'zod';

/** Public profile extras (decision.md D-071). */
export const SOCIAL_KEYS = ['github', 'linkedin', 'x', 'website'] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];
export type SocialLinks = Partial<Record<SocialKey, string>>;

export const BIO_MAX = 280;
export const AVATAR_MAX_BYTES = 256 * 1024;
export const AVATAR_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Which hosts each link may point at; the website can be anywhere (https only). */
const HOSTS: Record<SocialKey, string[] | null> = {
  github: ['github.com', 'www.github.com'],
  linkedin: ['linkedin.com', 'www.linkedin.com'],
  x: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
  website: null,
};

const link = (key: SocialKey) =>
  z.union([
    z.literal(''), // clears the link
    z
      .string()
      .trim()
      .max(200)
      .refine(
        (v) => {
          try {
            const u = new URL(v);
            const hosts = HOSTS[key];
            return u.protocol === 'https:' && (!hosts || hosts.includes(u.hostname.toLowerCase()));
          } catch {
            return false;
          }
        },
        `not a valid ${key === 'website' ? 'https' : key} link`,
      ),
  ]);

export const profileUpdateSchema = z.object({
  bio: z.string().max(BIO_MAX).optional(),
  links: z
    .object({
      github: link('github').optional(),
      linkedin: link('linkedin').optional(),
      x: link('x').optional(),
      website: link('website').optional(),
    })
    .optional(),
});
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

/** `data:image/(png|jpeg|webp);base64,...`; the server re-checks the bytes. */
export const avatarUploadSchema = z.object({
  image: z
    .string()
    .max(Math.ceil((AVATAR_MAX_BYTES * 4) / 3) + 64)
    .regex(
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/,
      'expected a PNG, JPEG or WebP image',
    ),
});

/** A row of the navbar's user search (decision.md D-073). */
export interface UserSearchHit {
  username: string;
  rating: number;
  avatarUrl: string | null;
}
