// DURU KOREAN — a short-lived link to one object in Cloudflare R2 (S3 signature version 4, query-signed).
// No library: the signing is a few lines of HMAC. Used by api/file-link.js and by scripts/r2-presign-check.mjs.

import crypto from 'node:crypto';

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
// The S3 flavour of URI encoding: RFC 3986, and ! ' ( ) * encoded too.
const enc = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (key) => String(key).split('/').map(enc).join('/');

// method: 'GET' to open or download the file, 'HEAD' to ask whether it is there.
// download: a file name (the browser saves it under that name) or true (save under the stored name).
export function presign({ account, accessKey, secretKey, bucket, key, method = 'GET', expires = 300, download = '', now = new Date() }) {
  const host = account + '.r2.cloudflarestorage.com';
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const scope = day + '/auto/s3/aws4_request';
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': accessKey + '/' + scope,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
    'response-content-type': 'application/pdf'
  };
  if (download) {
    const name = download === true ? String(key).split('/').pop() : String(download);
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    params['response-content-disposition'] = 'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'' + enc(name);
  }
  const query = Object.keys(params).sort().map((k) => enc(k) + '=' + enc(params[k])).join('&');
  const path = '/' + bucket + '/' + encPath(key);
  const canonical = [method, path, query, 'host:' + host + '\n', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + secretKey, day), 'auto'), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
  return 'https://' + host + path + '?' + query + '&X-Amz-Signature=' + signature;
}

export function r2FromEnv(env = process.env) {
  const account = env.R2_ACCOUNT_ID, accessKey = env.R2_ACCESS_KEY_ID, secretKey = env.R2_SECRET_ACCESS_KEY, bucket = env.R2_BUCKET;
  if (!account || !accessKey || !secretKey || !bucket) return null;
  return { account, accessKey, secretKey, bucket };
}
