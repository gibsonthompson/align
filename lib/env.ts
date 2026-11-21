// Reads configuration. Values are never logged or shown, only which names are missing.

export const ENV_NAMES = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ALIGN_PIN'] as const;

export function missingEnvNames(): string[] {
  const missing: string[] = ENV_NAMES.filter((n) => !process.env[n]);
  const pin = process.env.ALIGN_PIN;
  if (pin && !/^\d{4,12}$/.test(pin)) missing.push('ALIGN_PIN (must be 4 to 12 digits)');
  return missing;
}

export function pinLength(): number {
  const pin = process.env.ALIGN_PIN || '';
  return /^\d{4,12}$/.test(pin) ? pin.length : 0;
}
