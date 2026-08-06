import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';

/**
 * مصادِق برمجي (ES256) للاختبارات: ينفّذ مراسم WebAuthn الحقيقية بدل محاكاة
 * الردود — فما يتحقق منه الاختبار هو التوقيع والتحدي وربط النطاق فعلاً.
 */

function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64url');
}

/** CBOR مصغّر: يكفي خريطة المفتاح العام وكائن التصديق (fmt: none) */
function cborUInt(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 0x100) return Buffer.from([(major << 5) | 24, value]);
  if (value < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(value, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(value, 1);
  return b;
}
const cborInt = (n: number): Buffer =>
  n >= 0 ? cborUInt(0, n) : cborUInt(1, -n - 1);
const cborBytes = (b: Buffer): Buffer => Buffer.concat([cborUInt(2, b.length), b]);
const cborText = (s: string): Buffer => {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([cborUInt(3, b.length), b]);
};
const cborMap = (entries: [Buffer, Buffer][]): Buffer =>
  Buffer.concat([cborUInt(5, entries.length), ...entries.flat()]);

export interface SoftCredential {
  credentialId: string;
  privateKeyPem: string;
  publicKeyCose: Buffer;
  counter: number;
}

/** مفتاح COSE لمنحنى P-256 (alg -7) */
function coseKey(publicKeyDer: Buffer): Buffer {
  // آخر 65 بايت من SPKI هي النقطة غير المضغوطة 0x04 || X || Y
  const point = publicKeyDer.subarray(publicKeyDer.length - 65);
  const x = point.subarray(1, 33);
  const y = point.subarray(33, 65);
  return cborMap([
    [cborInt(1), cborInt(2)], // kty: EC2
    [cborInt(3), cborInt(-7)], // alg: ES256
    [cborInt(-1), cborInt(1)], // crv: P-256
    [cborInt(-2), cborBytes(x)],
    [cborInt(-3), cborBytes(y)],
  ]);
}

function authData(rpId: string, flags: number, counter: number, attested?: Buffer): Buffer {
  const rpIdHash = createHash('sha256').update(rpId).digest();
  const counterBuf = Buffer.alloc(4);
  counterBuf.writeUInt32BE(counter);
  return Buffer.concat([rpIdHash, Buffer.from([flags]), counterBuf, attested ?? Buffer.alloc(0)]);
}

function clientData(type: string, challenge: string, origin: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
}

/** ينشئ اعتماداً جديداً ويعيد رد التسجيل كما يرسله المتصفح */
export function createCredential(opts: { rpId: string; origin: string; challenge: string }) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

  const credentialIdBytes = randomBytes(32);
  const cose = coseKey(publicKeyDer);
  const credIdLen = Buffer.alloc(2);
  credIdLen.writeUInt16BE(credentialIdBytes.length);
  const attestedData = Buffer.concat([
    Buffer.alloc(16), // AAGUID أصفار — مصادِق غير معرّف
    credIdLen,
    credentialIdBytes,
    cose,
  ]);

  // UP | UV | AT
  const data = authData(opts.rpId, 0x01 | 0x04 | 0x40, 0, attestedData);
  const attestationObject = cborMap([
    [cborText('fmt'), cborText('none')],
    [cborText('attStmt'), cborMap([])],
    [cborText('authData'), cborBytes(data)],
  ]);
  const client = clientData('webauthn.create', opts.challenge, opts.origin);

  const credential: SoftCredential = {
    credentialId: b64url(credentialIdBytes),
    privateKeyPem,
    publicKeyCose: cose,
    counter: 0,
  };

  return {
    credential,
    response: {
      id: credential.credentialId,
      rawId: credential.credentialId,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(client),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
    },
  };
}

/** يوقّع تحدي الدخول بالاعتماد نفسه — كما يفعل الجهاز */
export function signAuthentication(
  credential: SoftCredential,
  opts: { rpId: string; origin: string; challenge: string; counter?: number },
) {
  const counter = opts.counter ?? credential.counter + 1;
  const data = authData(opts.rpId, 0x01 | 0x04, counter); // UP | UV
  const client = clientData('webauthn.get', opts.challenge, opts.origin);
  const clientHash = createHash('sha256').update(client).digest();

  const signature = createSign('SHA256')
    .update(Buffer.concat([data, clientHash]))
    .sign(credential.privateKeyPem);

  credential.counter = counter;
  return {
    id: credential.credentialId,
    rawId: credential.credentialId,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: b64url(client),
      authenticatorData: b64url(data),
      signature: b64url(signature),
    },
  };
}
