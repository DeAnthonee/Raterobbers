/** Invite links: `https://host/?code=ABCDE` lands a friend straight in the lobby. */
import { JOIN_CODE_LENGTH } from '@raterobbers/shared';

export const CODE_PATTERN = new RegExp(`^[A-Z]{${JOIN_CODE_LENGTH}}$`);

export function parseInviteCode(search: string): string | null {
  const raw = new URLSearchParams(search).get('code');
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

export function inviteLink(origin: string, code: string): string {
  return `${origin}/?code=${encodeURIComponent(code.toUpperCase())}`;
}
