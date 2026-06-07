'use strict'
const { encrypt, decrypt } = require('../lib/encryption')

const UID    = 'user-abc'
const SECRET = 'master-secret-x'
const TEXT   = 'my private key: 0xdeadbeef'

describe('encrypt / decrypt', () => {
  test('round-trip: decrypt(encrypt(plaintext)) === plaintext', () => {
    expect(decrypt(encrypt(TEXT, UID, SECRET), UID, SECRET)).toBe(TEXT)
  })

  test('output is iv:authTag:ciphertext (3 colon-separated parts)', () => {
    const parts = encrypt(TEXT, UID, SECRET).split(':')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toHaveLength(32) // 16-byte IV as hex
    expect(parts[1]).toHaveLength(32) // 16-byte auth tag as hex
    expect(parts[2].length).toBeGreaterThan(0)
  })

  test('uses a random IV: two encryptions of the same data differ', () => {
    expect(encrypt(TEXT, UID, SECRET)).not.toBe(encrypt(TEXT, UID, SECRET))
  })

  test('different UID produces a different ciphertext', () => {
    expect(encrypt(TEXT, 'uid-A', SECRET)).not.toBe(encrypt(TEXT, 'uid-B', SECRET))
  })

  test('different masterSecret produces a different ciphertext', () => {
    expect(encrypt(TEXT, UID, 'secret-1')).not.toBe(encrypt(TEXT, UID, 'secret-2'))
  })

  test('wrong masterSecret throws on decrypt (GCM auth tag mismatch)', () => {
    const cipher = encrypt(TEXT, UID, SECRET)
    expect(() => decrypt(cipher, UID, 'wrong-secret')).toThrow()
  })

  test('wrong UID throws on decrypt (GCM auth tag mismatch)', () => {
    const cipher = encrypt(TEXT, UID, SECRET)
    expect(() => decrypt(cipher, 'wrong-uid', SECRET)).toThrow()
  })

  test('tampered ciphertext body throws on decrypt', () => {
    const parts = encrypt(TEXT, UID, SECRET).split(':')
    parts[2] = parts[2].split('').reverse().join('') // flip payload bits
    expect(() => decrypt(parts.join(':'), UID, SECRET)).toThrow()
  })

  test('tampered auth tag throws on decrypt', () => {
    const parts = encrypt(TEXT, UID, SECRET).split(':')
    parts[1] = '0'.repeat(32) // zero out auth tag
    expect(() => decrypt(parts.join(':'), UID, SECRET)).toThrow()
  })

  test('invalid format (fewer than 3 parts) throws "Invalid encrypted format"', () => {
    expect(() => decrypt('not:valid', UID, SECRET)).toThrow('Invalid encrypted format')
  })

  test('invalid format (more than 3 parts) throws', () => {
    expect(() => decrypt('a:b:c:d', UID, SECRET)).toThrow()
  })

  test('round-trips an empty string', () => {
    expect(decrypt(encrypt('', UID, SECRET), UID, SECRET)).toBe('')
  })

  test('round-trips a long string (10 000 chars)', () => {
    const long = 'x'.repeat(10000)
    expect(decrypt(encrypt(long, UID, SECRET), UID, SECRET)).toBe(long)
  })

  test('round-trips a unicode / special-character string', () => {
    const special = '€ 🔑 \n\t "quotes" & <html> \'single\''
    expect(decrypt(encrypt(special, UID, SECRET), UID, SECRET)).toBe(special)
  })
})
