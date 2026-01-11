import { make_remote_request } from "../auth/unitree_auth"
import { rsa_encrypt, rsa_load_public_key, aes_decrypt, generate_aes_key } from "./encryption"
import * as forge from "node-forge"

import CryptoJS from "crypto-js"

export function generate_md5(string: string): string {
    return CryptoJS.MD5(string).toString()
}

export function generate_uuid(): string {
    function replace_char(char: string): string {
        const rand = Math.floor(Math.random() * 16)
        if (char === "x") {
            return rand.toString(16)
        } else if (char === "y") {
            return ((rand & 0x3) | 0x8).toString(16)
        }
        return char
    }

    const uuid_template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
    return uuid_template.replace(/[xy]/g, replace_char)
}

export function get_nested_field(message: Record<string, unknown>, ...fields: string[]): unknown {
    let current_level: unknown = message
    for (const field of fields) {
        if (typeof current_level === "object" && current_level !== null && field in current_level) {
            current_level = (current_level as Record<string, unknown>)[field]
        } else {
            return null
        }
    }
    return current_level
}

export async function fetch_token(email: string, password: string): Promise<string | null> {
    console.log("Obtaining TOKEN...")
    const path = "login/email"
    const body = {
        email: email,
        password: generate_md5(password),
    }
    const response = await make_remote_request(path, body, "", "POST")
    if (response.code === 100) {
        const data = response.data as Record<string, unknown>
        const access_token = data.accessToken as string
        return access_token
    } else {
        console.error("Failed to receive token")
        return null
    }
}

export async function fetch_public_key(): Promise<forge.pki.rsa.PublicKey | null> {
    console.log("Obtaining a Public key...")
    const path = "system/pubKey"

    try {
        const response = await make_remote_request(path, {}, "", "GET")
        if (response.code === 100) {
            const public_key_pem = response.data as string
            return rsa_load_public_key(public_key_pem)
        } else {
            console.error("Failed to receive public key")
            return null
        }
    } catch (e) {
        console.warn("No internet connection or failed to connect to the server. Unable to fetch public key.")
        console.error(`Connection error: ${e}`)
        return null
    }
}

export async function fetch_turn_server_info(
    serial: string,
    access_token: string,
    public_key: forge.pki.rsa.PublicKey
): Promise<Record<string, unknown> | null> {
    console.log("Obtaining TURN server info...")
    const aes_key = generate_aes_key()
    const path = "webrtc/account"
    const body = {
        sn: serial,
        sk: rsa_encrypt(aes_key, public_key),
    }
    const response = await make_remote_request(path, body, access_token, "POST")
    if (response.code === 100) {
        return JSON.parse(aes_decrypt(response.data as string, aes_key))
    } else {
        console.error("Failed to receive TURN server info")
        return null
    }
}

export function print_status(status_type: string, status_message: string): void {
    const current_time = new Date().toTimeString().split(" ")[0]
    console.log(`🕒 ${status_type.padEnd(25)}: ${status_message.padEnd(15)} (${current_time})`)
}
