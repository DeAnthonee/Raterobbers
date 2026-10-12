import { describe, expect, it } from 'vitest';
import { esc, safeColor } from './ui';

describe('esc', () => {
  it('escapes every HTML-significant character', () => {
    expect(esc(`<img src=x onerror="alert('1')">&`)).toBe(
      '&#60;img src=x onerror=&#34;alert(&#39;1&#39;)&#34;&#62;&#38;',
    );
    expect(esc('plain name')).toBe('plain name');
  });
});

describe('safeColor', () => {
  it('accepts only 6-digit hex', () => {
    expect(safeColor('#e74c3c')).toBe('#e74c3c');
    expect(safeColor('#ABCDEF')).toBe('#ABCDEF');
    expect(safeColor('red')).toBe('#ffffff');
    expect(safeColor('#fff" onmouseover="x')).toBe('#ffffff');
  });
});
