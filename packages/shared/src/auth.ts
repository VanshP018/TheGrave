import { z } from 'zod';

export const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/, 'Only letters, numbers and underscores'),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8).max(128),
  // School / college (decision.md D-076).
  institution: z.string().trim().min(2).max(100),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const verifyEmailSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const resendCodeSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});
export type ResendCodeInput = z.infer<typeof resendCodeSchema>;

/** Registration only starts at POST /auth/register; the account exists after the emailed code is verified. */
export interface RegisterStartResponse {
  email: string;
  /** Epoch ms when the code stops working. */
  expiresAt: number;
  /** Epoch ms when a new code may be requested. */
  resendAvailableAt: number;
}

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  rating: number;
  institution: string | null;
  /** null until a picture is uploaded (decision.md D-071). */
  avatarUrl: string | null;
}

export interface AuthResponse {
  accessToken: string;
  user: PublicUser;
}

export interface ApiError {
  error: string;
  message: string;
  issues?: { path: string; message: string }[];
  /** Registration code errors (decision.md D-076). */
  attemptsLeft?: number;
  retryAfterMs?: number;
}
