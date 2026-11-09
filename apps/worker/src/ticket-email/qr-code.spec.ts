import { describe, expect, it } from 'vitest';

import { qrCodePng } from './qr-code';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('QR do ingresso', () => {
  it('é um PNG', async () => {
    const png = await qrCodePng('token-de-exemplo');

    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  });

  it('muda com o token', async () => {
    const [a, b] = await Promise.all([qrCodePng('token-a'), qrCodePng('token-b')]);

    expect(a.equals(b)).toBe(false);
  });
});
