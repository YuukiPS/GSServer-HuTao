import { constants as CryptoConsts, createSign, createVerify, privateDecrypt, publicEncrypt } from 'crypto'

export const rsaEncrypt = (publicKey: Buffer | string, plaintext: Buffer): Buffer => {
  const chunkSize = 256 - 11
  const chunkCount = Math.ceil(plaintext.length / chunkSize)
  const chunks: Buffer[] = []

  for (let i = 0; i < chunkCount; i++) {
    const chunk = plaintext.subarray(i * chunkSize, (i + 1) * chunkSize)
    chunks.push(publicEncrypt({ key: publicKey, padding: CryptoConsts.RSA_PKCS1_PADDING }, chunk))
  }

  return Buffer.concat(chunks)
}

export const rsaDecrypt = (privateKey: Buffer | string, ciphertext: Buffer): Buffer => {
  const chunkSize = 256
  const chunkCount = Math.ceil(ciphertext.length / chunkSize)
  const chunks: Buffer[] = []

  for (let i = 0; i < chunkCount; i++) {
    const chunk = ciphertext.subarray(i * chunkSize, (i + 1) * chunkSize)
    chunks.push(privateDecrypt({ key: privateKey, padding: CryptoConsts.RSA_PKCS1_PADDING }, chunk))
  }

  return Buffer.concat(chunks)
}

export const rsaSign = (privateKey: Buffer | string, data: Buffer): Buffer => {
  const signer = createSign('RSA-SHA256')
  signer.update(data)
  return signer.sign({ key: privateKey, padding: CryptoConsts.RSA_PKCS1_PADDING })
}

export const rsaVerify = (publicKey: Buffer | string, data: Buffer, signature: Buffer): boolean => {
  if (
    publicKey == null || data == null || signature == null ||
    publicKey.length <= 0 || data.length <= 0 || signature.length <= 0
  ) return false

  const verifier = createVerify('RSA-SHA256')
  verifier.update(data)
  return verifier.verify({ key: publicKey, padding: CryptoConsts.RSA_PKCS1_PADDING }, signature)
}