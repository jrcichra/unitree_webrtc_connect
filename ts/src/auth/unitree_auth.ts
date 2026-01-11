import CryptoJS from "crypto-js"
import * as forge from "node-forge"
import { aes_encrypt, generate_aes_key, rsa_encrypt, aes_decrypt, rsa_load_public_key } from "../core/encryption"

export async function decrypt_con_notify_data(encrypted_b64: string): Promise<string> {
    try {
        // Decode base64
        const encryptedData = Uint8Array.from(atob(encrypted_b64), (c) => c.charCodeAt(0))

        if (encryptedData.length < 28) {
            throw new Error("Decryption failed: input data too short")
        }

        // Extract components (same format as Python)
        // const tag = encryptedData.slice(-16) // Last 16 bytes = GCM tag
        // const nonce = encryptedData.slice(-28, -16) // Next 12 bytes = nonce
        // const ciphertext = encryptedData.slice(0, -28) // Rest = ciphertext

        // For now, return a placeholder - full Web Crypto API implementation would require:
        // 1. AES-GCM key derivation from hardcoded key
        // 2. Proper GCM decryption with tag verification
        // 3. Error handling for authentication failures

        console.warn("AES-GCM decryption placeholder - needs full Web Crypto API implementation")
        return "decryption_placeholder"
    } catch (error) {
        console.error("AES-GCM decryption failed:", error)
        throw new Error("AES-GCM decryption not fully implemented yet")
    }
}

function _calc_local_path_ending(data1: string): string {
    const strArr = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]

    const last_10_chars = data1.slice(-10)

    const chunked: string[] = []
    for (let i = 0; i < last_10_chars.length; i += 2) {
        chunked.push(last_10_chars.slice(i, i + 2))
    }

    const arrayList: number[] = []
    for (const chunk of chunked) {
        if (chunk.length > 1) {
            const second_char = chunk[1]
            const index = strArr.indexOf(second_char)
            if (index !== -1) {
                arrayList.push(index)
            }
        }
    }

    return arrayList.join("")
}

export async function make_remote_request(
    path: string,
    body: Record<string, unknown>,
    token: string,
    method: string = "GET"
): Promise<Record<string, unknown>> {
    const APP_SIGN_SECRET = "XyvkwK45hp5PHfA8"
    const UM_CHANNEL_KEY = "UMENG_CHANNEL"
    const BASE_URL = "https://global-robot-api.unitree.com/"

    const app_timestamp = Math.floor(Date.now()).toString()
    const app_nonce = CryptoJS.MD5(app_timestamp).toString()

    const sign_str = `${APP_SIGN_SECRET}${app_timestamp}${app_nonce}`
    const app_sign = CryptoJS.MD5(sign_str).toString()

    const timezone_offset = new Date().getTimezoneOffset() / -60
    const sign = timezone_offset >= 0 ? "+" : "-"
    const abs_offset = Math.abs(timezone_offset)
    const hours = Math.floor(abs_offset)
    const minutes = Math.floor((abs_offset - hours) * 60)
    const app_timezone = `GMT${sign}${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`

    const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
        DeviceId: "Samsung/GalaxyS20/SM-G981B/s20/10/29",
        AppTimezone: app_timezone,
        DevicePlatform: "Android",
        DeviceModel: "SM-G981B",
        SystemVersion: "29",
        AppVersion: "1.8.0",
        AppLocale: "en_US",
        AppTimestamp: app_timestamp,
        AppNonce: app_nonce,
        AppSign: app_sign,
        Channel: UM_CHANNEL_KEY,
        Token: token,
        AppName: "Go2",
        Host: "global-robot-api.unitree.com",
        "User-Agent":
            "Mozilla/5.0 (Linux; Android 15; SM-S931B Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36",
    }

    const url = BASE_URL + path

    let response: Response
    if (method.toUpperCase() === "GET") {
        const params = new URLSearchParams(body as Record<string, string>)
        response = await fetch(`${url}?${params}`, { headers })
    } else {
        const encoded_body = new URLSearchParams(body as Record<string, string>)
        response = await fetch(url, {
            method: "POST",
            headers,
            body: encoded_body,
        })
    }

    return await response.json()
}

export async function make_local_request(
    path: string,
    body?: string,
    headers?: Record<string, string>
): Promise<Response | null> {
    try {
        const response = await fetch(path, {
            method: "POST",
            body,
            headers,
        })

        if (response.ok) {
            return response
        } else {
            return null
        }
    } catch (e) {
        console.error(`An error occurred: ${e}`)
        return null
    }
}

export async function send_sdp_to_remote_peer(
    serial: string,
    sdp: string,
    access_token: string,
    public_key: forge.pki.rsa.PublicKey
): Promise<string> {
    console.log("Sending SDP to Go2...")
    const aes_key = generate_aes_key()
    const path = "webrtc/connect"
    const body = {
        sn: serial,
        sk: rsa_encrypt(aes_key, public_key),
        data: aes_encrypt(sdp, aes_key),
        timeout: 5,
    }
    const response = await make_remote_request(path, body, access_token, "POST")
    if (response.code === 100) {
        console.log("Received SDP Answer from Go2!")
        return aes_decrypt(response.data, aes_key)
    } else if (response.code === 1000) {
        console.log("Device not online")
        throw new Error("Device not online")
    } else {
        throw new Error(`Failed to receive SDP Answer: ${JSON.stringify(response)}`)
    }
}

export async function send_sdp_to_local_peer(ip: string, sdp: string): Promise<string | null> {
    try {
        console.log("Trying to send SDP using the old method...")
        const response = await send_sdp_to_local_peer_old_method(ip, sdp)
        if (response) {
            console.log("SDP successfully sent using the old method.")
            return response
        } else {
            console.warn("Old method failed, trying the new method...")
        }
    } catch (e) {
        console.error(`An error occurred with the old method: ${e}`)
        console.log("Falling back to the new method...")
    }

    try {
        const response = await send_sdp_to_local_peer_new_method(ip, sdp)
        if (response) {
            console.log("SDP successfully sent using the new method.")
            return response
        } else {
            console.error("New method failed to send SDP.")
            return null
        }
    } catch (e) {
        console.error(`An error occurred with the new method: ${e}`)
        return null
    }
}

async function send_sdp_to_local_peer_old_method(ip: string, sdp: string): Promise<string | null> {
    try {
        const url = `http://${ip}:8081/offer`

        const headers = { "Content-Type": "application/json" }

        const response = await make_local_request(url, sdp, headers)

        if (response && response.ok) {
            const text = await response.text()
            console.log(`Received SDP: ${text}`)
            return text
        } else {
            throw new Error(`Failed to receive SDP Answer: ${response?.status || "No response"}`)
        }
    } catch (e) {
        console.error(`An error occurred while sending the SDP: ${e}`)
        return null
    }
}

async function send_sdp_to_local_peer_new_method(ip: string, sdp: string): Promise<string | null> {
    try {
        const url = `http://${ip}:9991/con_notify`

        const response = await make_local_request(url)

        if (response) {
            const text = await response.text()
            const decoded_response = atob(text)
            console.log(`Received con_notify response: ${decoded_response}`)

            const decoded_json = JSON.parse(decoded_response)

            let data1 = decoded_json.data1
            const data2 = decoded_json.data2

            if (data2 === 2) {
                data1 = await decrypt_con_notify_data(data1)
            }

            const public_key_pem = data1.slice(10, -10)
            const path_ending = _calc_local_path_ending(data1)

            const aes_key = generate_aes_key()

            const public_key = rsa_load_public_key(public_key_pem)

            const body = {
                data1: aes_encrypt(sdp, aes_key),
                data2: rsa_encrypt(aes_key, public_key),
            }

            const url2 = `http://${ip}:9991/con_ing_${path_ending}`

            const headers = { "Content-Type": "application/x-www-form-urlencoded" }

            const response2 = await make_local_request(url2, JSON.stringify(body), headers)

            if (response2) {
                const text2 = await response2.text()
                const decrypted_response = aes_decrypt(text2, aes_key)
                console.log(`Received con_ing_${path_ending} response: ${decrypted_response}`)
                return decrypted_response
            }
        } else {
            throw new Error("Failed to receive initial public key response.")
        }
    } catch (e) {
        console.error(`An error occurred while sending the SDP: ${e}`)
        return null
    }
    return null
}
