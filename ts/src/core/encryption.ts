import CryptoJS from "crypto-js"
import * as forge from "node-forge"

// RSA types are handled by forge library directly

export function _generate_uuid(): string {
    const uuid = CryptoJS.lib.WordArray.random(16)
    return uuid.toString()
}

export function pad(data: string): string {
    const block_size = 16
    const padding = block_size - (data.length % block_size)
    const padded_data = data + String.fromCharCode(padding).repeat(padding)
    return padded_data
}

export function unpad(data: string): string {
    const padding = data.charCodeAt(data.length - 1)
    return data.slice(0, -padding)
}

export function aes_encrypt(data: string, key: string): string {
    const key_bytes = CryptoJS.enc.Utf8.parse(key)
    const padded_data = pad(data)
    const encrypted = CryptoJS.AES.encrypt(padded_data, key_bytes, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.NoPadding,
    })
    return encrypted.toString()
}

export function aes_decrypt(encrypted_data: string, key: string): string {
    const key_bytes = CryptoJS.enc.Utf8.parse(key)
    const decrypted = CryptoJS.AES.decrypt(encrypted_data, key_bytes, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.NoPadding,
    })
    const decrypted_str = decrypted.toString(CryptoJS.enc.Utf8)
    return unpad(decrypted_str)
}

export function generate_aes_key(): string {
    return _generate_uuid()
}

export function rsa_load_public_key(pem_data: string): forge.pki.rsa.PublicKey {
    const derBytes = Uint8Array.from(atob(pem_data), c => c.charCodeAt(0))
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(derBytes))
    return forge.pki.publicKeyFromAsn1(asn1)
}

export function rsa_encrypt(data: string, public_key: forge.pki.rsa.PublicKey): string {
    const encrypted = public_key.encrypt(data, "RSAES-PKCS1-V1_5")
    return btoa(encrypted)
}
