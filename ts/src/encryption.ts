import CryptoJS from 'crypto-js';
import * as forge from 'node-forge';

// Re-export RSA types if needed
export namespace RSA {
    export interface RsaKey {
        // Using forge.pki.rsa.PublicKey
    }
}

export function _generate_uuid(): string {
    const uuid = CryptoJS.lib.WordArray.random(16);
    return uuid.toString();
}

export function pad(data: string): string {
    const block_size = 16;
    const padding = block_size - (data.length % block_size);
    const padded_data = data + String.fromCharCode(padding).repeat(padding);
    return padded_data;
}

export function unpad(data: string): string {
    const padding = data.charCodeAt(data.length - 1);
    return data.slice(0, -padding);
}

export function aes_encrypt(data: string, key: string): string {
    const key_bytes = CryptoJS.enc.Utf8.parse(key);
    const padded_data = pad(data);
    const encrypted = CryptoJS.AES.encrypt(padded_data, key_bytes, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.NoPadding
    });
    return encrypted.toString();
}

export function aes_decrypt(encrypted_data: string, key: string): string {
    const key_bytes = CryptoJS.enc.Utf8.parse(key);
    const decrypted = CryptoJS.AES.decrypt(encrypted_data, key_bytes, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.NoPadding
    });
    const decrypted_str = decrypted.toString(CryptoJS.enc.Utf8);
    return unpad(decrypted_str);
}

export function generate_aes_key(): string {
    return _generate_uuid();
}

export function rsa_load_public_key(pem_data: string): forge.pki.rsa.PublicKey {
    const key_bytes = atob(pem_data);
    return forge.pki.publicKeyFromPem(key_bytes);
}

export function rsa_encrypt(data: string, public_key: forge.pki.rsa.PublicKey): string {
    const encrypted = public_key.encrypt(data, 'RSAES-PKCS1-V1_5');
    return btoa(encrypted);
}
