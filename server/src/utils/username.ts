export const USERNAME_REGEX = /^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*$/;
export const USERNAME_FORMAT_ERROR =
  'Username may only contain letters, numbers, and dots (.) — underscores (_) are not allowed.';

export function validateUsernameFormat(username: string): string | null {
  if (!username) return 'Username is required.';
  if (!USERNAME_REGEX.test(username)) return USERNAME_FORMAT_ERROR;
  return null;
}
