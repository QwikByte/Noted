import { describe, expect, it } from 'vitest'
import {
  createVaultMaterial,
  decryptField,
  encryptField,
  hkdf,
  importKek,
  parseRecoveryKey,
  pbkdf2,
  renewRecoveryKey,
  rewrapWithPassword,
  seal,
  unlockWithPassword,
  unlockWithRecoveryKey,
  VaultError,
  wrapKey,
} from './crypto'
import {
  fromBase64url,
  fromCrockford,
  KDF_MIN_ITERATIONS,
  toBase64url,
  toCrockford,
  utf8,
  VAULT_ENVELOPE_RE,
} from './format'
import { MAX_VAULT_TITLE_ENVELOPE_LENGTH } from './limits'
import type { VaultInfo } from './types'

const hex = (s: string) => new Uint8Array(s.match(/../g)!.map((b) => parseInt(b, 16)))
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

async function rejects(promise: Promise<unknown>, code: VaultError['code']) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(VaultError)
  expect((err as VaultError).code).toBe(code)
}

describe('Tresor: Testvektoren der Verfahren', () => {
  it('PBKDF2-HMAC-SHA-256 (RFC 7914 §11)', async () => {
    expect(toHex(await pbkdf2('passwd', utf8('salt'), 1, 64))).toBe(
      '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc' +
        '49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783',
    )
    expect(toHex(await pbkdf2('Password', utf8('NaCl'), 80_000, 64))).toBe(
      '4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56' +
        'a1d425a1225833549adb841b51c9b3176a272bdebba1d078478f62b397f33c8d',
    )
  })

  it('AES-KW (RFC 3394 §4.6: 256-Bit-Schlüssel mit 256-Bit-KEK)', async () => {
    const kek = await importKek(hex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'))
    const data = await crypto.subtle.importKey(
      'raw',
      hex('00112233445566778899aabbccddeeff000102030405060708090a0b0c0d0e0f'),
      'AES-GCM',
      true,
      ['encrypt'],
    )
    expect(toHex(await wrapKey(kek, data))).toBe(
      '28c9f404c4b810f4cbccb35cfb87f8263f5786e2d80ed326cbc7f0e71a99f43bfb988b9b7a02dd21',
    )
  })

  it('HKDF-SHA-256 (RFC 5869 A.1)', async () => {
    const okm = await hkdf(hex('0b'.repeat(22)), hex('000102030405060708090a0b0c'), hex('f0f1f2f3f4f5f6f7f8f9'), 42)
    expect(toHex(okm)).toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865')
  })

  it('AES-GCM-256 (McGrew/Viega, Test Case 16)', async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      hex('feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308'),
      'AES-GCM',
      false,
      ['encrypt'],
    )
    const sealed = await seal(
      key,
      hex('cafebabefacedbaddecaf888'),
      hex('feedfacedeadbeeffeedfacedeadbeefabaddad2'),
      hex(
        'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a72' +
          '1c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39',
      ),
    )
    expect(toHex(sealed)).toBe(
      '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa' +
        '8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662' +
        '76fc6ece0f4e1768cddf8853bb2d551b',
    )
  })
})

describe('Tresor: eigenes Format, Version 1', () => {
  // Fest hinterlegt: Diese Daten müssen sich in allen künftigen Versionen öffnen lassen
  const id = '11111111-1111-4111-8111-111111111111'
  const golden: VaultInfo = {
    folderId: 'f',
    revision: 1,
    kdf: { name: 'PBKDF2-SHA-256', iterations: 600_000, salt: 'rH58HGnzvjls6yMIQBzWNA' },
    wrappedKey: 'lD6MnO-ywzoqCowb-XjojtTKwgaTv1U24Wcx_eW-qjCaTX8XT-QiNw',
    recoverySalt: 'SZoMLa6tAJfE9kaF5XVjlw',
    recoveryWrappedKey: '1vCfzil0yI5XJAsFsFWxFJxez-UIptUNXzx_4umcrqsrKXIcvMxQrA',
  }
  const title = 'nv1.ciDRqVmWS-WjWRfd.GDRZZ1CNrkYTz48cjY8kJaMkrXEzRQ5hPwh_YaRDGsnK3_I1aQ'
  const content = 'nv1.GsyIpNUnGr-qK5LU.-ePhuXfxRfX5mb_6g_BfupPrMy1ZnswZQhyr6ZnAudYJj6lKBG1v7wz-RRsjTbqX'

  it('öffnet den festen Tresor mit Passwort und Wiederherstellungsschlüssel', async () => {
    const key = await unlockWithPassword(golden, 'Tresor-Passwort für Tests')
    expect(await decryptField(key, id, 'title', title)).toBe('Geheimer Titel – Ä')
    expect(await decryptField(key, id, 'content', content)).toBe('# Quokka\nInhalt mit Ümlaut 🔒')
    // Klein geschrieben, ohne Bindestriche, mit O statt 0 und l statt 1
    const viaRecovery = await unlockWithRecoveryKey(golden, 'hgzbmwfmry7pcwrrmghy8qzrdhedme2d')
    expect(await decryptField(viaRecovery, id, 'content', content)).toBe('# Quokka\nInhalt mit Ümlaut 🔒')
    expect(key.extractable).toBe(false)
    expect(viaRecovery.extractable).toBe(false)
  })

  it('lehnt falsches Passwort und falschen Wiederherstellungsschlüssel ab', async () => {
    await rejects(unlockWithPassword(golden, 'Tresor-Passwort für test'), 'wrong_password')
    await rejects(unlockWithRecoveryKey(golden, 'HGZB-MWFM-RY7P-CWRR-MGHY-8QZR-DHED-ME2E'), 'wrong_recovery_key')
    await rejects(unlockWithRecoveryKey(golden, 'zu kurz'), 'wrong_recovery_key')
  })

  it('erkennt veränderte, vertauschte und kaputte Umschläge', async () => {
    const key = await unlockWithPassword(golden, 'Tresor-Passwort für Tests')
    const flipped = content.slice(0, -2) + (content.at(-2) === 'A' ? 'B' : 'A') + content.at(-1)
    await rejects(decryptField(key, id, 'content', flipped), 'corrupt')
    await rejects(decryptField(key, '22222222-2222-4222-8222-222222222222', 'content', content), 'corrupt')
    await rejects(decryptField(key, id, 'title', content), 'corrupt')
    await rejects(decryptField(key, id, 'content', 'Klartext'), 'corrupt')
    await rejects(decryptField(key, id, 'content', ''), 'corrupt')
  })

  it('lehnt unbekannte und zu schwache Schlüsselableitung ab', async () => {
    const weak = { ...golden, kdf: { ...golden.kdf, iterations: KDF_MIN_ITERATIONS - 1 } }
    await rejects(unlockWithPassword(weak, 'Tresor-Passwort für Tests'), 'unsupported_kdf')
    const other = { ...golden, kdf: { ...golden.kdf, name: 'argon2id' } } as unknown as VaultInfo
    await rejects(unlockWithPassword(other, 'Tresor-Passwort für Tests'), 'unsupported_kdf')
  })
})

describe('Tresor: Schlüssel anlegen und neu verpacken', () => {
  it('legt einen Tresor an, verschlüsselt mit frischem IV und hält die Längen ein', async () => {
    const { material, recoveryKey, key } = await createVaultMaterial('ein langer Satz als Passwort')
    expect(material.kdf).toMatchObject({ name: 'PBKDF2-SHA-256', iterations: 600_000 })
    expect(recoveryKey).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(key.extractable).toBe(false)
    const info: VaultInfo = { ...material, folderId: 'f', revision: 1 }
    const a = await encryptField(key, 'n', 'content', 'gleich')
    const b = await encryptField(key, 'n', 'content', 'gleich')
    expect(a).not.toBe(b)
    expect(a).toMatch(VAULT_ENVELOPE_RE)
    const reopened = await unlockWithRecoveryKey(info, recoveryKey)
    expect(await decryptField(reopened, 'n', 'content', a)).toBe('gleich')
    // Längster Titel: 200 Zeichen, die je 3 Bytes UTF-8 brauchen
    expect((await encryptField(key, 'n', 'title', '語'.repeat(200))).length).toBeLessThanOrEqual(
      MAX_VAULT_TITLE_ENVELOPE_LENGTH,
    )
  })

  it('wechselt das Passwort und erneuert den Wiederherstellungsschlüssel ohne Neuverschlüsselung', async () => {
    const { material, recoveryKey, key } = await createVaultMaterial('altes Passwort, lang genug')
    let info: VaultInfo = { ...material, folderId: 'f', revision: 1 }
    const envelope = await encryptField(key, 'n', 'content', 'bleibt lesbar')

    info = {
      ...info,
      ...(await rewrapWithPassword(info, { password: 'altes Passwort, lang genug' }, 'neues Passwort, lang genug')),
    }
    await rejects(unlockWithPassword(info, 'altes Passwort, lang genug'), 'wrong_password')
    expect(
      await decryptField(await unlockWithPassword(info, 'neues Passwort, lang genug'), 'n', 'content', envelope),
    ).toBe('bleibt lesbar')
    // Passwort vergessen: mit dem Wiederherstellungsschlüssel ein neues setzen
    info = { ...info, ...(await rewrapWithPassword(info, { recoveryKey }, 'drittes Passwort, lang genug')) }
    expect(
      await decryptField(await unlockWithPassword(info, 'drittes Passwort, lang genug'), 'n', 'content', envelope),
    ).toBe('bleibt lesbar')
    const renewed = await renewRecoveryKey(info, 'drittes Passwort, lang genug')
    info = { ...info, recoverySalt: renewed.recoverySalt, recoveryWrappedKey: renewed.recoveryWrappedKey }
    await rejects(unlockWithRecoveryKey(info, recoveryKey), 'wrong_recovery_key')
    expect(await decryptField(await unlockWithRecoveryKey(info, renewed.recoveryKey), 'n', 'content', envelope)).toBe(
      'bleibt lesbar',
    )
  })

  it('normalisiert das Passwort (NFC): zusammengesetztes und zerlegtes „Ä“ sind gleich', async () => {
    const composed = 'Äpfel und Birnen, lange'
    const decomposed = composed.normalize('NFD')
    expect(decomposed).not.toBe(composed)
    const { material } = await createVaultMaterial(composed)
    await unlockWithPassword({ ...material, folderId: 'f', revision: 1 }, decomposed)
  })
})

describe('Tresor: Kodierungen', () => {
  it('Base64url ohne Auffüllung, auch für alle Restlängen', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = new Uint8Array(Array.from({ length: n }, (_, i) => (i * 37 + n) & 255))
      const text = toBase64url(bytes)
      expect(text).not.toMatch(/[+/=]/)
      expect(fromBase64url(text)).toEqual(bytes)
    }
    expect(toBase64url(new Uint8Array([251, 255]))).toBe('-_8')
    expect(fromBase64url('ab+c')).toBeNull()
    expect(fromBase64url('abcde')).toBeNull()
  })

  it('Wiederherstellungsschlüssel als Crockford-Base32', () => {
    const bytes = new Uint8Array(Array.from({ length: 20 }, (_, i) => i * 13))
    const text = toCrockford(bytes)
    expect(text).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
    expect(fromCrockford(text, 20)).toEqual(bytes)
    expect(parseRecoveryKey(text.toLowerCase().replace(/-/g, ' '))).toEqual(bytes)
    expect(parseRecoveryKey(text.replace(/0/g, 'O').replace(/1/g, 'l'))).toEqual(bytes)
    expect(parseRecoveryKey(text + '0')).toBeNull()
    expect(parseRecoveryKey(text.slice(0, -1) + 'U')).toBeNull()
  })
})
