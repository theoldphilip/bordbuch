/** Helpers for inviting a family member: a readable start password and the invitation text. */

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i that look alike

/** Three groups of four characters, e.g. "k7mq-x2ap-r9tz" (about 60 bits). Works without HTTPS. */
export function generatePassword(): string {
  const limit = 256 - (256 % ALPHABET.length); // reject the top values so every character is equally likely
  const out: string[] = [];
  while (out.length < 12) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    for (const b of bytes) if (b < limit && out.length < 12) out.push(ALPHABET[b % ALPHABET.length]!);
  }
  return [out.slice(0, 4), out.slice(4, 8), out.slice(8, 12)].map((g) => g.join('')).join('-');
}

export function inviteText(input: { displayName: string; username: string; password: string | null; address: string }): string {
  return [
    `Hallo ${input.displayName},`,
    '',
    'du hast jetzt Zugang zu Bordbuch, unserem Reiseplaner.',
    '',
    `Adresse: ${input.address}`,
    `Benutzername: ${input.username}`,
    input.password ? `Startpasswort: ${input.password}` : 'Das Startpasswort bekommst du separat von mir.',
    '',
    "So geht's:",
    '1. VPN (WireGuard) einschalten.',
    '2. Die Adresse oben in Safari öffnen und anmelden.',
    '3. Dem Einrichtungsdialog folgen (Zertifikat, Home-Bildschirm, Erinnerungen).',
    '4. Das Passwort unter Einstellungen → Konto ändern.',
  ].join('\n');
}

/** Copies text. navigator.clipboard needs HTTPS, so fall back to a hidden textarea. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
