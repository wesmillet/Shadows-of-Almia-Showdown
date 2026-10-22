/**
 * Just enough S3 to keep backups off the machine: signed PUT and GET (AWS Signature Version 4),
 * path-style, so it works with any S3-compatible store: Fly's Tigris (`fly storage create` sets
 * every variable below), Cloudflare R2, Backblaze B2, AWS itself.
 *
 *   AWS_ENDPOINT_URL_S3   e.g. https://fly.storage.tigris.dev
 *   AWS_REGION            e.g. auto
 *   BUCKET_NAME
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 */
import { createHash, createHmac } from 'node:crypto';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export function s3FromEnv(env = process.env): S3Config | null {
  const endpoint = env.AWS_ENDPOINT_URL_S3 ?? env.S3_ENDPOINT;
  const bucket = env.BUCKET_NAME ?? env.S3_BUCKET;
  const accessKey = env.AWS_ACCESS_KEY_ID;
  const secretKey = env.AWS_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  return { endpoint: endpoint.replace(/\/$/, ''), region: env.AWS_REGION ?? 'auto', bucket, accessKey, secretKey };
}

const sha256hex = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const hmac = (k: Buffer | string, s: string) => createHmac('sha256', k).update(s).digest();

/** Each path segment encoded the way SigV4 wants (RFC 3986, '/' kept). */
function encodePath(p: string): string {
  return p.split('/').map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

/**
 * Signs a request: returns its headers plus Authorization. Every header passed is signed (host and
 * x-amz-date are added). `date` is for tests.
 */
export function signV4(o: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  payloadHash: string;
  region: string;
  service: string;
  accessKey: string;
  secretKey: string;
  date?: Date;
}): Record<string, string> {
  const u = new URL(o.url);
  const amzDate = (o.date ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { host: u.host, 'x-amz-date': amzDate };
  for (const [k, v] of Object.entries(o.headers ?? {})) headers[k.toLowerCase()] = v;
  const names = Object.keys(headers).sort();
  const canonHeaders = names.map((k) => `${k}:${String(headers[k]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signed = names.join(';');
  const query = [...u.searchParams]
    .map(([k, v]): [string, string] => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonical = [o.method, encodePath(decodeURIComponent(u.pathname)) || '/', query, canonHeaders, signed, o.payloadHash].join('\n');
  const scope = `${day}/${o.region}/${o.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${o.secretKey}`, day), o.region), o.service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${o.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}` };
}

function objectUrl(c: S3Config, key: string): string {
  return `${c.endpoint}/${c.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export async function s3Put(c: S3Config, key: string, body: Buffer, contentType = 'application/octet-stream'): Promise<void> {
  const url = objectUrl(c, key);
  const payloadHash = sha256hex(body);
  const headers = signV4({ method: 'PUT', url, headers: { 'content-type': contentType, 'x-amz-content-sha256': payloadHash }, payloadHash, region: c.region, service: 's3', accessKey: c.accessKey, secretKey: c.secretKey });
  delete headers.host;
  const r = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(body) });
  if (!r.ok) throw new Error(`S3 PUT ${key}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}

export async function s3Get(c: S3Config, key: string): Promise<Buffer> {
  const url = objectUrl(c, key);
  const payloadHash = sha256hex('');
  const headers = signV4({ method: 'GET', url, headers: { 'x-amz-content-sha256': payloadHash }, payloadHash, region: c.region, service: 's3', accessKey: c.accessKey, secretKey: c.secretKey });
  delete headers.host;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`S3 GET ${key}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
