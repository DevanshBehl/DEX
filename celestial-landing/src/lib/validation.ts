/**
 * Zod-based password validation for Celestial wallet onboarding.
 * Enforces: min 8 chars, at least one uppercase, one number, one special character.
 */
import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character');

export const onboardingPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
    acknowledged: z.boolean().refine((val) => val === true, {
      message: 'You must acknowledge the recovery warning',
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type PasswordFormData = z.infer<typeof onboardingPasswordSchema>;

/** Individual rule checks for the strength indicator UI */
export interface PasswordRules {
  minLength: boolean;
  hasUppercase: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
}

export function checkPasswordRules(password: string): PasswordRules {
  return {
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: /[^A-Za-z0-9]/.test(password),
  };
}

/** Returns a 0-4 strength score based on how many rules pass */
export function getPasswordStrength(password: string): number {
  if (!password) return 0;
  const rules = checkPasswordRules(password);
  return [rules.minLength, rules.hasUppercase, rules.hasNumber, rules.hasSpecial].filter(Boolean).length;
}

export function getStrengthLabel(strength: number): string {
  switch (strength) {
    case 0: return '';
    case 1: return 'Weak';
    case 2: return 'Fair';
    case 3: return 'Strong';
    case 4: return 'Very Strong';
    default: return '';
  }
}

export function getStrengthColor(strength: number): string {
  switch (strength) {
    case 1: return '#ef4444';
    case 2: return '#f59e0b';
    case 3: return '#22c55e';
    case 4: return '#22c55e';
    default: return 'rgba(255,255,255,0.08)';
  }
}
