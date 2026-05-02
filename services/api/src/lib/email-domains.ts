/**
 * Throwaway-email domain block list. Not exhaustive — just the obvious ones.
 * Goal is to deter casual abuse during the launch window without blocking the
 * long tail of niche providers (which always misfires on real users).
 */
const DISPOSABLE_DOMAINS = new Set<string>([
  '0-mail.com',
  '10minutemail.com',
  'discard.email',
  'dispostable.com',
  'fakeinbox.com',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamailblock.com',
  'inboxbear.com',
  'mailinator.com',
  'maildrop.cc',
  'mintemail.com',
  'mohmal.com',
  'mytemp.email',
  'sharklasers.com',
  'spam4.me',
  'tempmail.com',
  'temp-mail.org',
  'temporarymail.com',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
]);

export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return DISPOSABLE_DOMAINS.has(domain);
}
