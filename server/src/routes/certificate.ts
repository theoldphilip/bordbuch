/**
 * The public HTTPS certificate for the iPhone. The admin uploads it once (only the certificate, never the
 * private key), everyone can then download it from the app and install it on the phone. It is public
 * information, so the download needs no login: Safari opens the link without the app's token.
 */
import fs from 'node:fs';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { requireAdmin } from '../auth.ts';
import { HttpError } from '../util.ts';

export interface CertInfo {
  subject: string;
  validFrom: string;
  validTo: string;
  daysLeft: number;
  altNames: string[];
  fingerprint: string;
}

/** Throws a readable HttpError for anything that is not a usable public certificate. */
export function inspectCertificate(pem: string, now = Date.now(), allowExpired = false): { pem: string; info: CertInfo } {
  if (/PRIVATE KEY/.test(pem)) {
    throw new HttpError(400, 'Diese Datei enthält einen privaten Schlüssel. Lade nur das Zertifikat hoch (bordbuch.pem), nie den Schlüssel.');
  }
  const block = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0];
  if (!block) throw new HttpError(400, 'Das ist kein Zertifikat im PEM-Format („-----BEGIN CERTIFICATE-----“).');
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(block);
  } catch {
    throw new HttpError(400, 'Das Zertifikat konnte nicht gelesen werden.');
  }
  const validTo = new Date(cert.validTo);
  if (!allowExpired && validTo.getTime() < now) throw new HttpError(400, `Das Zertifikat ist am ${validTo.toLocaleDateString('de-CH')} abgelaufen.`);
  return {
    pem: block + '\n',
    info: {
      subject: cert.subject.replace(/\n/g, ', '),
      validFrom: new Date(cert.validFrom).toISOString(),
      validTo: validTo.toISOString(),
      daysLeft: Math.floor((validTo.getTime() - now) / 86_400_000),
      altNames: (cert.subjectAltName ?? '').split(', ').filter(Boolean),
      fingerprint: cert.fingerprint256,
    },
  };
}

export function registerCertificateRoutes(app: FastifyInstance, { config }: Ctx) {
  const file = path.join(config.dataDir, 'certificate.pem');
  const read = (): string | null => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

  app.get('/api/certificate/info', async () => {
    const pem = read();
    if (!pem) return { present: false };
    return { present: true, ...inspectCertificate(pem, Date.now(), true).info };
  });

  /** Public download. DER format with the CA content type makes iOS offer to install it as a profile. */
  app.get<{ Querystring: { format?: string } }>('/api/certificate', { config: { public: true } }, async (req, reply) => {
    const pem = read();
    if (!pem) throw new HttpError(404, 'Es wurde noch kein Zertifikat hinterlegt.');
    if (req.query.format === 'pem') {
      return reply.header('Content-Type', 'application/x-pem-file').header('Content-Disposition', 'attachment; filename="bordbuch.pem"').send(pem);
    }
    return reply
      .header('Content-Type', 'application/x-x509-ca-cert')
      .header('Content-Disposition', 'attachment; filename="bordbuch.crt"')
      .header('Cache-Control', 'no-store')
      .send(new X509Certificate(pem).raw);
  });

  app.put('/api/certificate', async (req) => {
    requireAdmin(req);
    const { pem } = z.object({ pem: z.string().max(20_000) }).parse(req.body);
    const checked = inspectCertificate(pem);
    fs.writeFileSync(file, checked.pem, { mode: 0o644 });
    return { present: true, ...checked.info };
  });

  app.delete('/api/certificate', async (req, reply) => {
    requireAdmin(req);
    fs.rmSync(file, { force: true });
    return reply.status(204).send();
  });
}
