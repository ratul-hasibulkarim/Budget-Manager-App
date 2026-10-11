/**
 * Minimal device accounts: the server issues a user id and a signed token (HMAC-SHA256).
 * Uses Web Crypto, so the same code runs on Node and on Cloudflare Workers.
 * Google sign-in will later link these accounts so they survive a lost phone.
 */

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class Auth {
  constructor(private readonly secret: string) {
    if (secret.length < 32) throw new Error('AUTH_SECRET must be at least 32 characters');
  }

  async issue(): Promise<{ userId: string; token: string }> {
    const userId = `u${b64url(crypto.getRandomValues(new Uint8Array(16)))}`;
    return { userId, token: `${userId}.${await hmac(this.secret, userId)}` };
  }

  /** Returns the user id for a valid token, or null. */
  async verify(token: string | undefined): Promise<string | null> {
    if (!token) return null;
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const userId = token.slice(0, dot);
    if (!/^u[A-Za-z0-9_-]{10,40}$/.test(userId)) return null;
    return timingSafeEqual(token.slice(dot + 1), await hmac(this.secret, userId)) ? userId : null;
  }
}
