import { AUDIO_API } from "../constants"
import { WebRTCDataChannel } from "./webrtc_datachannel"
import { UnitreeWebRTCConnection } from "./webrtc_driver"

export class WebRTCAudioHub {
    conn: UnitreeWebRTCConnection
    data_channel: WebRTCDataChannel

    constructor(connection: UnitreeWebRTCConnection) {
        this.conn = connection
        this.data_channel = connection.datachannel
    }

    async get_audio_list(): Promise<Record<string, unknown>> {
        const response = await this.data_channel.pub_sub.publish(
            "rt/api/audiohub/request",
            {
                api_id: AUDIO_API.GET_AUDIO_LIST,
                parameter: JSON.stringify({}),
            },
            "request" // Using generic type since pub_sub is stubbed
        )
        return response
    }

    async play_by_uuid(uuid: string): Promise<void> {
        await this.data_channel.pub_sub.publish(
            "rt/api/audiohub/request",
            {
                api_id: AUDIO_API.SELECT_START_PLAY,
                parameter: JSON.stringify({
                    unique_id: uuid,
                }),
            },
            "request"
        )
    }

    async pause(): Promise<void> {
        await this.data_channel.pub_sub.publish(
            "rt/api/audiohub/request",
            {
                api_id: AUDIO_API.PAUSE,
                parameter: JSON.stringify({}),
            },
            "request"
        )
    }

    async resume(): Promise<void> {
        await this.data_channel.pub_sub.publish(
            "rt/api/audiohub/request",
            {
                api_id: AUDIO_API.UNSUSPEND,
                parameter: JSON.stringify({}),
            },
            "request"
        )
    }

    async set_play_mode(play_mode: string): Promise<void> {
        await this.data_channel.pub_sub.publish(
            "rt/api/audiohub/request",
            {
                api_id: AUDIO_API.SET_PLAY_MODE,
                parameter: JSON.stringify({
                    play_mode: play_mode,
                }),
            },
            "request"
        )
    }

    async rename_record(uuid: string, new_name: string): Promise<void> {
        await this.data_channel.pub_sub.publish(
            "rt/api/audiohub/request",
            {
                api_id: AUDIO_API.SELECT_RENAME,
                parameter: JSON.stringify({
                    unique_id: uuid,
                    new_name: new_name,
                }),
            },
            "request"
        )
    }

    async delete_record(uuid: string): Promise<void> {
        await this.data_channel.pub_sub.publish(
            "rt/api/audiohub/request",
            {
                api_id: AUDIO_API.SELECT_DELETE,
                parameter: JSON.stringify({
                    unique_id: uuid,
                }),
            },
            "request"
        )
    }

    async get_play_mode(): Promise<Record<string, unknown>> {
        const response = await this.data_channel.pub_sub.publish(
            "rt/api/audiohub/request",
            {
                api_id: AUDIO_API.GET_PLAY_MODE,
                parameter: JSON.stringify({}),
            },
            "request"
        )
        return response
    }

    async upload_audio_file(audioFile: File): Promise<Record<string, unknown>> {
        // Read file as ArrayBuffer
        const audioData = await audioFile.arrayBuffer()
        const audioBytes = new Uint8Array(audioData)

        try {
            // Calculate MD5 (simplified - in real implementation use crypto.subtle)
            const hashBuffer = await crypto.subtle.digest("SHA-256", audioBytes)
            const fileMd5 = Array.from(new Uint8Array(hashBuffer))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("")

            // Convert to base64
            const b64Data = btoa(String.fromCharCode(...audioBytes))

            // Split into chunks (4KB each)
            const chunkSize = 4096
            const chunks: string[] = []
            for (let i = 0; i < b64Data.length; i += chunkSize) {
                chunks.push(b64Data.slice(i, i + chunkSize))
            }
            const totalChunks = chunks.length

            console.log(`Splitting file into ${totalChunks} chunks`)

            let lastResponse: Record<string, unknown> = {}

            // Send each chunk
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i]
                const parameter = {
                    file_name: audioFile.name.replace(/\.[^/.]+$/, ""), // Remove extension
                    file_type: "wav", // Assume WAV for simplicity
                    file_size: audioBytes.length,
                    current_block_index: i + 1,
                    total_block_number: totalChunks,
                    block_content: chunk,
                    current_block_size: chunk.length,
                    file_md5: fileMd5,
                    create_time: Date.now(),
                }

                console.log(`Sending chunk ${i + 1}/${totalChunks}`)

                lastResponse = await this.data_channel.pub_sub.publish(
                    "rt/api/audiohub/request",
                    {
                        api_id: AUDIO_API.UPLOAD_AUDIO_FILE,
                        parameter: JSON.stringify(parameter),
                    },
                    "request"
                )

                // Small delay between chunks
                await new Promise((resolve) => setTimeout(resolve, 100))
            }

            console.log("All chunks sent")
            return lastResponse
        } catch (error) {
            console.error(`Error uploading audio file: ${error}`)
            throw error
        }
    }

    async enter_megaphone(): Promise<void> {
        await this.data_channel.pub_sub.publish(
            "rt/api/audiohub/request",
            {
                api_id: AUDIO_API.ENTER_MEGAPHONE,
                parameter: JSON.stringify({}),
            },
            "request"
        )
    }

    async exit_megaphone(): Promise<void> {
        await this.data_channel.pub_sub.publish(
            "rt/api/audiohub/request",
            {
                api_id: AUDIO_API.EXIT_MEGAPHONE,
                parameter: JSON.stringify({}),
            },
            "request"
        )
    }

    async upload_megaphone(audioFile: File): Promise<Record<string, unknown>> {
        // Similar to upload_audio_file but for megaphone
        const audioData = await audioFile.arrayBuffer()
        const audioBytes = new Uint8Array(audioData)

        const b64Data = btoa(String.fromCharCode(...audioBytes))

        // Split into chunks
        const chunkSize = 4096
        const chunks: string[] = []
        for (let i = 0; i < b64Data.length; i += chunkSize) {
            chunks.push(b64Data.slice(i, i + chunkSize))
        }
        const totalChunks = chunks.length

        console.log(`Splitting megaphone file into ${totalChunks} chunks`)

        let lastResponse: Record<string, unknown> = {}

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i]
            const parameter = {
                current_block_size: chunk.length,
                block_content: chunk,
                current_block_index: i + 1,
                total_block_number: totalChunks,
            }

            console.log(`Sending megaphone chunk ${i + 1}/${totalChunks}`)

            lastResponse = await this.data_channel.pub_sub.publish(
                "rt/api/audiohub/request",
                {
                    api_id: AUDIO_API.UPLOAD_MEGAPHONE,
                    parameter: JSON.stringify(parameter),
                },
                "request"
            )

            await new Promise((resolve) => setTimeout(resolve, 100))
        }

        console.log("All megaphone chunks sent")
        return lastResponse
    }
}
