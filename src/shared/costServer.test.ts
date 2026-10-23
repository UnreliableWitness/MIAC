import { describe, expect, it } from 'vitest';
import { validServerUrl } from './costServer';

describe('validServerUrl', () => {
  it('accepts https and local http only', () => {
    expect(validServerUrl('https://x')).toBe(true);
    expect(validServerUrl('http://localhost:5000')).toBe(true);
    expect(validServerUrl('http://127.0.0.1:5000')).toBe(true);
    expect(validServerUrl('http://cost.example')).toBe(false);
    expect(validServerUrl('ftp://x')).toBe(false);
    expect(validServerUrl('not a url')).toBe(false);
  });
});
