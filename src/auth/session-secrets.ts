import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const opaqueSecret = () => randomBytes(32).toString('base64url');
export const isOpaqueSecret = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const secretHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const secretsEqual = (expected: string, received: string) =>
  timingSafeEqual(Buffer.from(secretHash(expected), 'hex'), Buffer.from(secretHash(received), 'hex'));

export const SESSION_COOKIE = 'roombook_session';

export function browserCookieName(name: string, localHttp: boolean): string {
  return localHttp ? name : '__Host-' + name;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  const values = (header ?? '').split(';').map((value) => value.trim())
    .filter((value) => value.startsWith(name + '='));
  const value = values[0]?.slice(name.length + 1);
  return values.length === 1 && isOpaqueSecret(value) ? value : undefined;
}

export class SessionSecrets {
  private readonly key: Buffer;

  constructor(key: string) {
    this.key = Buffer.from(key, 'hex');
  }

  seal(value: object, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
  }

  open<T>(envelope: string, context: string): T {
    const [iv, tag, ciphertext, ...rest] = envelope.split('.').map((part) => Buffer.from(part, 'base64url'));
    if (iv?.length !== 12 || tag?.length !== 16 || !ciphertext?.length || rest.length) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as T;
  }
}
