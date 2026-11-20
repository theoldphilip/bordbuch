import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { setup } from './helpers.ts';
import { inspectCertificate } from '../src/routes/certificate.ts';

// Self-signed test certificate for 172.16.10.1 (CN=Bordbuch, 10 years). The private key was discarded.
const CERT = `-----BEGIN CERTIFICATE-----
MIIDLTCCAhWgAwIBAgIUZSICeW+8K7ZuVqkEyO0YQ+KwK7swDQYJKoZIhvcNAQEL
BQAwEzERMA8GA1UEAwwIQm9yZGJ1Y2gwHhcNMjYxMTIwMjEzMjUyWhcNMzYxMTE3
MjEzMjUyWjATMREwDwYDVQQDDAhCb3JkYnVjaDCCASIwDQYJKoZIhvcNAQEBBQAD
ggEPADCCAQoCggEBAKFseKN2/OXvQK3j0s+HtQDfls4kDd8orDAlyKWiQkDKihWP
Qs6tKXP5EjN5fcc1mc91tBCgzHXg93ivmh1z+3v/KiKQVgS753Kk/fk6iSPLo7Nn
1t04oXpUMswE20zHLE/WvEEouMg0Bn7cJveV16K7mQief3pxZubQXK3TYv51p/64
J6dpNYIxCi6vvaaRPV2XNYQJU9Yrzowholnl/8vvboEM/mVqsBKfvDZPIG94+2J9
diMTwZ5khVN3JeXuzKAgthr1OkRWY7hp7m1PyckZfiY7k5+vwAq/AAU/AikrPIGA
Vv/Ifnu90KsaWXF2rmrdNLB3uphq1zyGtn28IhsCAwEAAaN5MHcwHQYDVR0OBBYE
FF2wY3T+RY7ArLpT4cJsziyJGDxgMB8GA1UdIwQYMBaAFF2wY3T+RY7ArLpT4cJs
ziyJGDxgMA8GA1UdEwEB/wQFMAMBAf8wDwYDVR0RBAgwBocErBAKATATBgNVHSUE
DDAKBggrBgEFBQcDATANBgkqhkiG9w0BAQsFAAOCAQEASnrFwbL+pmOn2/EJK4WW
ny3PuO/nG07ppq6isMOIOptO8eoS7I6JPLQhsLCrhrErVxrqZ43FLxxVNMjXZ+fU
cfnqmmqXmBiWE0JDaQBLSWGuCrcBYQp/7UV7vVz/l3Q7c+maS5mmOd6eHhsnTcbv
jnGt1txs+3oKnjc+4Bcy80oqtwz8qCZtSbOTjrvrj9LcLZGa8zcMBu2FKyNs6Ppy
D7JNo78WMynwqbGFA4/WsiHlcg4DhVTxp7rSbnpUX5GKrNWzA/tFs8Y4V0jGR/Sn
BvZTrGPXgoRKgtls5UHfbrpr2I6nuiLHc+1scH3VOIzJF6OhzA3BF8yf+HjcVIU5
5g==
-----END CERTIFICATE-----
`;
const KEY_BLOCK = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n';

describe('inspectCertificate', () => {
  test('reads subject, address, validity', () => {
    const { info, pem } = inspectCertificate(CERT);
    assert.equal(info.subject, 'CN=Bordbuch');
    assert.ok(info.altNames.includes('IP Address:172.16.10.1'));
    assert.ok(info.daysLeft > 3000);
    assert.match(info.fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    assert.ok(pem.startsWith('-----BEGIN CERTIFICATE-----') && pem.endsWith('-----END CERTIFICATE-----\n'));
  });

  test('refuses private keys, even next to a certificate', () => {
    assert.throws(() => inspectCertificate(KEY_BLOCK), /privaten Schlüssel/);
    assert.throws(() => inspectCertificate(CERT + KEY_BLOCK), /privaten Schlüssel/);
  });

  test('refuses garbage and expired certificates, but can still describe an expired one', () => {
    assert.throws(() => inspectCertificate('hallo'), /kein Zertifikat/);
    assert.throws(() => inspectCertificate('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----'), /nicht gelesen/);
    const later = Date.now() + 11 * 365 * 86_400_000;
    assert.throws(() => inspectCertificate(CERT, later), /abgelaufen/);
    assert.ok(inspectCertificate(CERT, later, true).info.daysLeft < 0);
  });
});

describe('certificate API', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let admin = '';
  let anna = '';
  before(async () => {
    ctx = await setup();
    admin = (await ctx.call('POST', '/api/setup', undefined, { username: 'philip', displayName: 'Philip', password: 'geheim123' })).body.token;
    await ctx.call('POST', '/api/users', admin, { username: 'anna', displayName: 'Anna', password: 'annapass1' });
    anna = (await ctx.call('POST', '/api/auth/login', undefined, { username: 'anna', password: 'annapass1' })).body.token;
  });
  after(async () => ctx.cleanup());

  test('nothing there at first', async () => {
    assert.deepEqual((await ctx.call('GET', '/api/certificate/info', anna)).body, { present: false });
    assert.equal((await ctx.call('GET', '/api/certificate')).status, 404);
  });

  test('only the admin uploads, and only a certificate', async () => {
    assert.equal((await ctx.call('PUT', '/api/certificate', anna, { pem: CERT })).status, 403);
    assert.equal((await ctx.call('PUT', '/api/certificate', admin, { pem: KEY_BLOCK })).status, 400);
    assert.equal((await ctx.call('PUT', '/api/certificate', admin, { pem: 'x'.repeat(30_000) })).status, 400);
    const ok = await ctx.call('PUT', '/api/certificate', admin, { pem: CERT });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.subject, 'CN=Bordbuch');
  });

  test('everyone sees the info; the download needs no login and installs on iOS', async () => {
    const info = (await ctx.call('GET', '/api/certificate/info', anna)).body;
    assert.equal(info.present, true);
    assert.ok(info.altNames.includes('IP Address:172.16.10.1'));
    assert.equal((await ctx.call('GET', '/api/certificate/info')).status, 401, 'info is for logged-in users');

    const der = await ctx.app.inject({ method: 'GET', url: '/api/certificate' });
    assert.equal(der.statusCode, 200);
    assert.equal(der.headers['content-type'], 'application/x-x509-ca-cert');
    assert.match(String(der.headers['content-disposition']), /bordbuch\.crt/);
    assert.deepEqual(der.rawPayload, new X509Certificate(CERT).raw, 'DER bytes of the uploaded certificate');

    const pem = await ctx.app.inject({ method: 'GET', url: '/api/certificate?format=pem' });
    assert.match(pem.body, /BEGIN CERTIFICATE/);
    assert.ok(!/PRIVATE KEY/.test(pem.body));
  });

  test('the admin can remove it again', async () => {
    assert.equal((await ctx.call('DELETE', '/api/certificate', anna)).status, 403);
    assert.equal((await ctx.call('DELETE', '/api/certificate', admin)).status, 204);
    assert.equal((await ctx.call('GET', '/api/certificate')).status, 404);
  });
});
