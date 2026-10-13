import { describe, expect, it } from 'vitest';
import { inviteLink, parseInviteCode } from './invite';

describe('invite links', () => {
  it('parses and normalises a code from the query string', () => {
    expect(parseInviteCode('?code=abcde')).toBe('ABCDE');
    expect(parseInviteCode('?x=1&code=ABCDE')).toBe('ABCDE');
    expect(parseInviteCode('?code=%20abcde%20')).toBe('ABCDE');
  });

  it('rejects missing or malformed codes', () => {
    expect(parseInviteCode('')).toBeNull();
    expect(parseInviteCode('?code=')).toBeNull();
    expect(parseInviteCode('?code=abc')).toBeNull();
    expect(parseInviteCode('?code=<script>')).toBeNull();
    expect(parseInviteCode('?code=ABCDEFGH')).toBeNull();
  });

  it('builds a link that parses back to the same code', () => {
    const link = inviteLink('https://raterobbers.deanthoneeking.com', 'qwert');
    expect(link).toBe('https://raterobbers.deanthoneeking.com/?code=QWERT');
    expect(parseInviteCode(new URL(link).search)).toBe('QWERT');
  });
});
