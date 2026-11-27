export const PHONE_REGEX = /^\+?[0-9]{10,15}$/;

export function normalizePhone(value: string): string {
  const phone = value.trim().replace(/[\s()-]/g, '');
  if (!PHONE_REGEX.test(phone)) return phone;
  const digits = phone.replace(/^\+/, '');
  return /^8801\d{9}$/.test(digits) ? digits.slice(2) : digits;
}
