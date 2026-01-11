import { DATA_CHANNEL_TYPE } from "../constants"
import { print_status, get_nested_field, generate_md5, generate_uuid } from "../core/util"
import { UnifiedLidarDecoder } from "../lidar/lidar_decoder"

// Future resolver for handling async responses
class FutureResolver {
    private pendingResponses: { [key: string]: Promise<unknown>[] } = {}
    private pendingCallbacks: {
        [key: string]: { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }[]
    } = {}
    private chunkDataStorage: { [key: string]: Uint8Array[] } = {}

    saveResolve(
        messageType: string,
        topic: string,
        resolver: { resolve: (value: unknown) => void; reject: (reason?: unknown) => void },
        identifier: string
    ) {
        const key = identifier || `${messageType}$${topic}`
        if (this.pendingCallbacks[key]) {
            this.pendingCallbacks[key].push(resolver)
        } else {
            this.pendingCallbacks[key] = [resolver]
        }
    }

    runResolveForTopic(message: Record<string, unknown>) {
        if (!message.type) return

        if (
            message.type === DATA_CHANNEL_TYPE.RTC_INNER_REQ &&
            get_nested_field(message, "info", "req_type") === "request_static_file"
        ) {
            this.runResolveForTopicForFile(message)
            return
        }

        const key = this.generateMessageKey(
            message.type,
            message.topic || "",
            get_nested_field(message, "data", "uuid") ||
                get_nested_field(message, "data", "header", "identity", "id") ||
                get_nested_field(message, "info", "uuid") ||
                get_nested_field(message, "info", "req_uuid")
        )

        const contentInfo = get_nested_field(message, "data", "content_info")
        if (contentInfo && contentInfo.enable_chunking) {
            const chunkIndex = contentInfo.chunk_index
            const totalChunks = contentInfo.total_chunk_num

            if (totalChunks === 0) {
                throw new Error("Total number of chunks cannot be zero")
            }
            if (chunkIndex === undefined) {
                throw new Error("Chunk index is missing")
            }

            const dataChunk = message.data.data
            if (chunkIndex < totalChunks) {
                if (this.chunkDataStorage[key]) {
                    this.chunkDataStorage[key].push(dataChunk)
                } else {
                    this.chunkDataStorage[key] = [dataChunk]
                }
                return
            } else {
                this.chunkDataStorage[key].push(dataChunk)
                message.data.data = this.mergeArrayBuffers(this.chunkDataStorage[key])
                delete this.chunkDataStorage[key]
            }
        }

        if (this.pendingCallbacks[key]) {
            for (const future of this.pendingCallbacks[key]) {
                if (future) {
                    ;(future as unknown).resolve(message)
                }
            }
            delete this.pendingCallbacks[key]
        }
    }

    private runResolveForTopicForFile(message: unknown) {
        const key = this.generateMessageKey(
            message.type,
            message.topic || "",
            get_nested_field(message, "data", "uuid") ||
                get_nested_field(message, "data", "header", "identity", "id") ||
                get_nested_field(message, "info", "uuid") ||
                get_nested_field(message, "info", "req_uuid")
        )

        const fileInfo = get_nested_field(message, "info", "file")
        if (fileInfo && fileInfo.enable_chunking) {
            const chunkIndex = fileInfo.chunk_index
            const totalChunks = fileInfo.total_chunk_num

            if (totalChunks === 0) {
                throw new Error("Total number of chunks cannot be zero")
            }
            if (chunkIndex === undefined) {
                throw new Error("Chunk index is missing")
            }

            const dataChunk = fileInfo.data
            if (this.chunkDataStorage[key]) {
                this.chunkDataStorage[key].push(
                    typeof dataChunk === "string" ? new TextEncoder().encode(dataChunk) : dataChunk
                )
            } else {
                this.chunkDataStorage[key] = [
                    typeof dataChunk === "string" ? new TextEncoder().encode(dataChunk) : dataChunk,
                ]
            }

            if (chunkIndex === totalChunks) {
                message.info.file.data = new Uint8Array(this.mergeArrayBuffers(this.chunkDataStorage[key]))
                delete this.chunkDataStorage[key]
            }
        }

        if (this.pendingCallbacks[key]) {
            for (const future of this.pendingCallbacks[key]) {
                if (future) {
                    ;(future as unknown).resolve(message)
                }
            }
            delete this.pendingCallbacks[key]
        }
    }

    private mergeArrayBuffers(buffers: Uint8Array[]): Uint8Array {
        const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0)
        const merged = new Uint8Array(totalLength)
        let currentPosition = 0
        for (const buffer of buffers) {
            merged.set(buffer, currentPosition)
            currentPosition += buffer.length
        }
        return merged
    }

    private generateMessageKey(messageType: string, topic: string, identifier: string): string {
        return identifier || `${messageType}$${topic}`
    }
}

// Main pub/sub class for data channel communication
class WebRTCDataChannelPubSub {
    private channel: RTCDataChannel
    private futureResolver: FutureResolver
    private subscriptions: { [topic: string]: (message: unknown) => void } = {}

    constructor(channel: RTCDataChannel) {
        this.channel = channel
        this.futureResolver = new FutureResolver()
    }

    runResolve(message: unknown) {
        this.futureResolver.runResolveForTopic(message)

        const topic = message.topic
        if (topic && this.subscriptions[topic]) {
            this.subscriptions[topic](message)
        }
    }

    async publish(topic: string, data: unknown = null, msgType: string = DATA_CHANNEL_TYPE.MSG): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (this.channel.readyState === "open") {
                const messageDict: unknown = {
                    type: msgType,
                    topic: topic,
                }

                if (data !== null) {
                    messageDict.data = data
                }

                const message = JSON.stringify(messageDict)
                this.channel.send(message)
                console.log("> message sent:", message)

                const uuid =
                    get_nested_field(data, "uuid") ||
                    get_nested_field(data, "header", "identity", "id") ||
                    get_nested_field(data, "req_uuid")

                this.futureResolver.saveResolve(msgType, topic, { resolve, reject }, uuid)
            } else {
                reject(new Error("Data channel is not open"))
            }
        })
    }

    publishWithoutCallback(topic: string, data: unknown = null, msgType: string = DATA_CHANNEL_TYPE.MSG) {
        if (this.channel.readyState === "open") {
            const messageDict: unknown = {
                type: msgType,
                topic: topic,
            }

            if (data !== null) {
                messageDict.data = data
            }

            const message = JSON.stringify(messageDict)
            this.channel.send(message)
            console.log("> message sent:", message)
        } else {
            throw new Error("Data channel is not open")
        }
    }

    async publishRequestNew(topic: string, options: unknown = {}): Promise<unknown> {
        const generatedId = (Date.now() % 2147483648) + Math.floor(Math.random() * 1000)

        if (!options || !options.api_id) {
            throw new Error("Please provide app id")
        }

        const requestPayload: unknown = {
            header: {
                identity: {
                    id: options.id || generatedId,
                    api_id: options.api_id,
                },
            },
            parameter: "",
        }

        if (options && options.parameter) {
            requestPayload.parameter =
                typeof options.parameter === "string" ? options.parameter : JSON.stringify(options.parameter)
        }

        if (options && options.priority) {
            requestPayload.header.policy = {
                priority: 1,
            }
        }

        return this.publish(topic, requestPayload, DATA_CHANNEL_TYPE.REQUEST)
    }

    subscribe(topic: string, callback?: (message: unknown) => void) {
        if (this.channel.readyState !== "open") {
            console.error("Error: Data channel is not open")
            return
        }

        if (callback) {
            this.subscriptions[topic] = callback
        }

        this.publishWithoutCallback(topic, null, DATA_CHANNEL_TYPE.SUBSCRIBE)
    }

    unsubscribe(topic: string) {
        if (this.channel.readyState !== "open") {
            console.error("Error: Data channel is not open")
            return
        }

        this.publishWithoutCallback(topic, null, DATA_CHANNEL_TYPE.UNSUBSCRIBE)
    }
}

class WebRTCDataChannelHeartBeat {
    private channel: RTCDataChannel
    private publish: (topic: string, data: unknown, type: string) => void
    private heartbeatTimer: number | null = null
    private heartbeatResponse: unknown = null

    constructor(channel: RTCDataChannel, pub_sub: WebRTCDataChannelPubSub) {
        this.channel = channel
        this.publish = pub_sub.publishWithoutCallback.bind(pub_sub)
    }

    private formatDate(timestamp: number): string {
        return new Date(timestamp * 1000).toISOString().replace("T", " ").substring(0, 19)
    }

    startHeartbeat(): void {
        this.heartbeatTimer = window.setInterval(() => {
            this.sendHeartbeat()
        }, 2000)
    }

    stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer)
            this.heartbeatTimer = null
        }
    }

    private sendHeartbeat(): void {
        if (this.channel.readyState === "open") {
            const currentTime = Date.now() / 1000
            const formattedTime = this.formatDate(currentTime)
            const data = {
                timeInStr: formattedTime,
                timeInNum: Math.floor(currentTime),
            }
            this.publish("", data, DATA_CHANNEL_TYPE.HEARTBEAT)
        }
    }

    handleResponse(_message: unknown): void {
        this.heartbeatResponse = Date.now() / 1000
        console.log("Heartbeat response received.")
    }
}

class WebRTCDataChannelValidation {
    private channel: RTCDataChannel
    private publish: (topic: string, data: unknown, type: string) => Promise<unknown>
    private onValidateCallbacks: (() => void)[] = []
    private key: string = ""

    constructor(channel: RTCDataChannel, pub_sub: WebRTCDataChannelPubSub) {
        this.channel = channel
        this.publish = pub_sub.publish.bind(pub_sub)
    }

    setOnValidateCallback(callback: () => void): void {
        if (callback && typeof callback === "function") {
            this.onValidateCallbacks.push(callback)
        }
    }

    async handleResponse(message: unknown): Promise<void> {
        if (message.data === "Validation Ok.") {
            console.log("Validation succeed")
            for (const callback of this.onValidateCallbacks) {
                callback()
            }
        } else {
            this.channel.dispatchEvent(new Event("open"))
            this.key = message.data
            await this.publish("", this.encryptKey(this.key), DATA_CHANNEL_TYPE.VALIDATION)
        }
    }

    async handleErrResponse(message: unknown): Promise<void> {
        if (message.info === "Validation Needed.") {
            await this.publish("", this.encryptKey(this.key), DATA_CHANNEL_TYPE.VALIDATION)
        }
    }

    private hexToBase64(hexStr: string): string {
        const matches = hexStr.match(/.{1,2}/g)
        if (!matches) throw new Error("Invalid hex string")
        const bytes = new Uint8Array(matches.map((byte) => parseInt(byte, 16)))
        let binary = ""
        bytes.forEach((byte) => (binary += String.fromCharCode(byte)))
        return btoa(binary)
    }

    private encryptByMd5(inputStr: string): string {
        // Using the imported generate_md5 function
        return generate_md5(inputStr)
    }

    private encryptKey(key: string): string {
        const prefixedKey = `UnitreeGo2_${key}`
        const encrypted = this.encryptByMd5(prefixedKey)
        return this.hexToBase64(encrypted)
    }
}

class WebRTCChannelProbeResponse {
    private channel: RTCDataChannel
    private publish: (topic: string, data: unknown, type: string) => void

    constructor(channel: RTCDataChannel, pub_sub: WebRTCDataChannelPubSub) {
        this.channel = channel
        this.publish = pub_sub.publishWithoutCallback.bind(pub_sub)
    }

    handleResponse(_info: unknown) {
        // this.publish("", info, DATA_CHANNEL_TYPE.RTC_INNER_REQ)
    }
}

class WebRTCDataChannelNetworkStatus {
    private conn: unknown
    private channel: RTCDataChannel
    private publish: (topic: string, data: unknown, type: string) => Promise<unknown>
    private networkTimer: number | null = null
    private networkStatus: string = ""
    private onNetworkStatusCallbacks: ((mode: string) => void)[] = []

    constructor(conn: unknown, channel: RTCDataChannel, pub_sub: WebRTCDataChannelPubSub) {
        this.conn = conn
        this.channel = channel
        this.publish = pub_sub.publish.bind(pub_sub)
    }

    setOnNetworkStatusCallback(callback: (mode: string) => void): void {
        if (callback && typeof callback === "function") {
            this.onNetworkStatusCallbacks.push(callback)
        }
    }

    startNetworkStatusFetch(): void {
        this.networkTimer = window.setInterval(() => {
            this.scheduleNetworkStatusRequest()
        }, 1000)
    }

    stopNetworkStatusFetch(): void {
        if (this.networkTimer) {
            clearInterval(this.networkTimer)
            this.networkTimer = null
        }
    }

    private scheduleNetworkStatusRequest(): void {
        this.sendNetworkStatusRequest().catch((error) => {
            console.error("Failed to publish:", error)
        })
    }

    private async sendNetworkStatusRequest(): Promise<void> {
        const data = {
            req_type: "public_network_status",
            uuid: generate_uuid(),
        }
        try {
            const response = await this.publish("", data, DATA_CHANNEL_TYPE.RTC_INNER_REQ)
            this.handleResponse(response.get("info"))
        } catch (error) {
            console.error("Failed to publish:", error)
        }
    }

    private handleResponse(info: unknown): void {
        console.log("Network status message received.")
        const status = info.get("status")
        if (status === "Undefined" || status === "NetworkStatus.DISCONNECTED") {
            // Schedule the next network status request in 0.5s
            setTimeout(() => this.scheduleNetworkStatusRequest(), 500)
        } else if (status === "NetworkStatus.ON_4G_CONNECTED") {
            this.networkStatus = "4G"
            this.stopNetworkStatusFetch()
        } else if (status === "NetworkStatus.ON_WIFI_CONNECTED") {
            // This would need to be adjusted based on the WebRTCConnectionMethod enum
            // For now, we'll assume it's STA-L
            this.networkStatus = "STA-L"
        }

        if (status === "NetworkStatus.ON_4G_CONNECTED" || status === "NetworkStatus.ON_WIFI_CONNECTED") {
            for (const callback of this.onNetworkStatusCallbacks) {
                callback(this.networkStatus)
            }
            this.stopNetworkStatusFetch()
        }
    }
}

class WebRTCDataChannelFileUploader {
    private channel: RTCDataChannel
    private publish: (topic: string, data: unknown, type: string) => Promise<unknown>
    private cancelUpload: boolean = false

    constructor(channel: RTCDataChannel, pub_sub: WebRTCDataChannelPubSub) {
        this.channel = channel
        this.publish = pub_sub.publish.bind(pub_sub)
    }

    private sliceBase64IntoChunks(data: string, chunkSize: number): string[] {
        const chunks: string[] = []
        for (let i = 0; i < data.length; i += chunkSize) {
            chunks.push(data.slice(i, i + chunkSize))
        }
        return chunks
    }

    async uploadFile(
        data: Uint8Array,
        filePath: string,
        chunkSize: number = 60 * 1024,
        progressCallback?: (progress: number) => void
    ): Promise<string> {
        // Encode to base64
        const b64Data = btoa(String.fromCharCode(...data))
        console.log(`Total size after Base64 encoding: ${b64Data.length}`)

        const chunks = this.sliceBase64IntoChunks(b64Data, chunkSize)
        const totalChunks = chunks.length

        this.cancelUpload = false

        // Calculate MD5
        const fileMd5 = generate_md5(b64Data)

        for (let i = 0; i < chunks.length; i++) {
            if (this.cancelUpload) {
                console.log("Upload canceled.")
                return "cancel"
            }

            if (i % 5 === 0) {
                await new Promise((resolve) => setTimeout(resolve, 500))
            }

            const chunk = chunks[i]
            const uuid = generate_uuid()
            const reqUuid = `upload_req_${uuid}`

            const message = {
                req_type: "push_static_file",
                req_uuid: reqUuid,
                related_bussiness: "uslam_final_pcd",
                file_md5: fileMd5,
                file_path: filePath,
                file_size_after_b64: b64Data.length,
                file: {
                    chunk_index: i + 1,
                    total_chunk_num: totalChunks,
                    chunk_data: chunk,
                    chunk_data_size: chunk.length,
                },
            }

            this.publish("", message, DATA_CHANNEL_TYPE.RTC_INNER_REQ)

            if (progressCallback) {
                progressCallback(Math.floor(((i + 1) / totalChunks) * 100))
            }
        }

        return "ok"
    }

    cancel(): void {
        this.cancelUpload = true
    }
}

class WebRTCDataChannelFileDownloader {
    private channel: RTCDataChannel
    private publish: (topic: string, data: unknown, type: string) => Promise<unknown>
    private cancelDownload: boolean = false

    constructor(channel: RTCDataChannel, pub_sub: WebRTCDataChannelPubSub) {
        this.channel = channel
        this.publish = pub_sub.publish.bind(pub_sub)
    }

    async downloadFile(
        filePath: string,
        _chunkSize: number = 60 * 1024,
        progressCallback?: (progress: number) => void
    ): Promise<Uint8Array> {
        this.cancelDownload = false

        try {
            const uuid = generate_uuid()

            // Send download request
            const requestMessage = {
                req_type: "request_static_file",
                req_uuid: `req_${uuid}`,
                related_bussiness: "uslam_final_pcd",
                file_md5: "null",
                file_path: filePath,
            }

            const response = await this.publish("", requestMessage, DATA_CHANNEL_TYPE.RTC_INNER_REQ)

            if (this.cancelDownload) {
                console.log("Download canceled.")
                throw new Error("cancel")
            }

            // The complete data should be merged in the FutureResolver
            const completeData = response.info?.file?.data

            if (!completeData) {
                throw new Error("Failed to get the file data.")
            }

            // Decode from base64
            const decodedData = Uint8Array.from(atob(completeData), (c) => c.charCodeAt(0))

            if (progressCallback) {
                progressCallback(100)
            }

            return decodedData
        } catch (error) {
            console.error("Failed to download file:", error)
            throw error
        }
    }

    cancel(): void {
        this.cancelDownload = true
    }
}

class WebRTCDataChannelRTCInnerReq {
    private conn: unknown
    private channel: RTCDataChannel
    public network_status: WebRTCDataChannelNetworkStatus
    private probeRes: WebRTCChannelProbeResponse
    public file_uploader: WebRTCDataChannelFileUploader
    public file_downloader: WebRTCDataChannelFileDownloader

    constructor(conn: unknown, channel: RTCDataChannel, pub_sub: WebRTCDataChannelPubSub) {
        this.conn = conn
        this.channel = channel

        this.network_status = new WebRTCDataChannelNetworkStatus(this.conn, this.channel, pub_sub)
        this.probeRes = new WebRTCChannelProbeResponse(this.channel, pub_sub)
        this.file_uploader = new WebRTCDataChannelFileUploader(this.channel, pub_sub)
        this.file_downloader = new WebRTCDataChannelFileDownloader(this.channel, pub_sub)
    }

    handleResponse(msg: unknown): void {
        const info = msg.info
        const reqType = info?.req_type
        if (reqType === "rtt_probe_send_from_mechine") {
            this.probeRes.handleResponse(info)
        }
    }
}

function integerToHexString(errorCode: number): string {
    if (typeof errorCode !== "number") {
        throw new Error("Input must be an integer.")
    }
    return errorCode.toString(16).toUpperCase()
}

function getErrorCodeText(errorSource: number, errorCode: string): string {
    const app_error_messages: { [key: string]: string } = {
        app_error_code_100_1: "DDS message timeout",
        app_error_code_100_10: "Battery communication error",
        app_error_code_100_2: "Distribution switch abnormal",
        app_error_code_100_20: "Abnormal mote control communication",
        app_error_code_100_40: "MCU communication error",
        app_error_code_100_80: "Motor communication error",
        app_error_code_200_1: "Rear left fan jammed",
        app_error_code_200_2: "Rear right fan jammed",
        app_error_code_200_4: "Front fan jammed",
        app_error_code_300_1: "Overcurrent",
        app_error_code_300_10: "Winding overheating",
        app_error_code_300_100: "Motor communication interruption",
        app_error_code_300_2: "Overvoltage",
        app_error_code_300_20: "Encoder abnormal",
        app_error_code_300_4: "Driver overheating",
        app_error_code_300_8: "Generatrix undervoltage",
        app_error_code_400_1: "Motor rotate speed abnormal",
        app_error_code_400_10: "Abnormal dirt index",
        app_error_code_400_2: "PointCloud data abnormal",
        app_error_code_400_4: "Serial port data abnormal",
        app_error_code_500_1: "UWB serial port open abnormal",
        app_error_code_500_2: "Robot dog information retrieval abnormal",
        app_error_code_600_4: "Overheating software protection",
        app_error_code_600_8: "Low battery software protection",
        app_error_source_100: "Communication firmware malfunction",
        app_error_source_200: "Communication firmware malfunction",
        app_error_source_300: "Motor malfunction",
        app_error_source_400: "Radar malfunction",
        app_error_source_500: "UWB malfunction",
        app_error_source_600: "Motion Control",
        app_error_wheel_300_100: "Motor Communication Interruption",
        app_error_wheel_300_40: "Calibration Data Abnormality",
        app_error_wheel_300_80: "Abnormal Reset",
    }

    const key = `app_error_code_${errorSource}_${errorCode}`
    return app_error_messages[key] || `${errorSource}-${errorCode}`
}

function getErrorSourceText(errorSource: number): string {
    const app_error_messages: { [key: string]: string } = {
        app_error_source_100: "Communication firmware malfunction",
        app_error_source_200: "Communication firmware malfunction",
        app_error_source_300: "Motor malfunction",
        app_error_source_400: "Radar malfunction",
        app_error_source_500: "UWB malfunction",
        app_error_source_600: "Motion Control",
    }

    const key = `app_error_source_${errorSource}`
    return app_error_messages[key] || `${errorSource}`
}

function handle_error(message: unknown) {
    const data = message.data

    for (const error of data) {
        const [timestamp, errorSource, errorCodeInt] = error

        const readableTime = new Date(timestamp * 1000).toISOString().replace("T", " ").substring(0, 19)
        const errorSourceText = getErrorSourceText(errorSource)
        const errorCodeHex = integerToHexString(errorCodeInt)
        const errorCodeText = getErrorCodeText(errorSource, errorCodeHex)

        console.log(
            `\n🚨 Error Received from Go2:\n` +
                `🕒 Time:          ${readableTime}\n` +
                `🔢 Error Source:  ${errorSourceText}\n` +
                `❗ Error Code:    ${errorCodeText}\n`
        )
    }
}

export class WebRTCDataChannel {
    channel: RTCDataChannel
    data_channel_opened: boolean = false
    conn: unknown
    pub_sub: WebRTCDataChannelPubSub
    heartbeat: WebRTCDataChannelHeartBeat
    validation: WebRTCDataChannelValidation
    rtc_inner_req: WebRTCDataChannelRTCInnerReq
    decoder!: UnifiedLidarDecoder

    constructor(conn: unknown, pc: RTCPeerConnection) {
        this.channel = pc.createDataChannel("data")
        this.conn = conn

        this.pub_sub = new WebRTCDataChannelPubSub(this.channel)
        this.heartbeat = new WebRTCDataChannelHeartBeat(this.channel, this.pub_sub)
        this.validation = new WebRTCDataChannelValidation(this.channel, this.pub_sub)
        this.rtc_inner_req = new WebRTCDataChannelRTCInnerReq(conn, this.channel, this.pub_sub)

        this.set_decoder("libvoxel")

        // Event handler for Validation succeed
        const on_validate = () => {
            this.data_channel_opened = true
            this.heartbeat.startHeartbeat()
            this.rtc_inner_req.network_status.startNetworkStatusFetch()
            print_status("Data Channel Verification", "✅ OK")
        }

        this.validation.setOnValidateCallback(on_validate)

        // Event handler for Network status Update
        const on_network_status = (mode: string) => {
            console.log(`Go2 connection mode: ${mode}`)
        }

        this.rtc_inner_req.network_status.setOnNetworkStatusCallback(on_network_status)

        // Event handler for data channel open
        this.channel.onopen = () => {
            console.log("Data channel opened")
        }

        // Event handler for data channel close
        this.channel.onclose = () => {
            console.log("Data channel closed")
            this.data_channel_opened = false
            this.heartbeat.stopHeartbeat()
            this.rtc_inner_req.network_status.stopNetworkStatusFetch()
        }

        // Event handler for data channel messages
        this.channel.onmessage = async (event) => {
            console.log("Received message on data channel:", event.data)
            try {
                let parsed_data: unknown

                if (typeof event.data === "string") {
                    parsed_data = JSON.parse(event.data)
                } else if (event.data instanceof ArrayBuffer) {
                    parsed_data = this.deal_array_buffer(event.data)
                } else {
                    return
                }

                this.pub_sub.runResolve(parsed_data)
                await this.handle_response(parsed_data)
            } catch (error) {
                console.error("Error processing WebRTC data", error)
            }
        }
    }

    async handle_response(msg: unknown) {
        const msg_type = msg.type

        if (msg_type === DATA_CHANNEL_TYPE.VALIDATION) {
            await this.validation.handleResponse(msg)
        } else if (msg_type === DATA_CHANNEL_TYPE.RTC_INNER_REQ) {
            this.rtc_inner_req.handleResponse(msg)
        } else if (msg_type === DATA_CHANNEL_TYPE.HEARTBEAT) {
            this.heartbeat.handleResponse(msg)
        } else if (
            [DATA_CHANNEL_TYPE.ERRORS, DATA_CHANNEL_TYPE.ADD_ERROR, DATA_CHANNEL_TYPE.RM_ERROR].includes(msg_type)
        ) {
            handle_error(msg)
        } else if (msg_type === DATA_CHANNEL_TYPE.ERR) {
            await this.validation.handleErrResponse(msg)
        }
    }

    async wait_datachannel_open(timeout: number = 5): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.data_channel_opened) {
                resolve()
                return
            }

            const timer = setTimeout(() => {
                reject(new Error("Data channel did not open in time"))
            }, timeout * 1000)

            const checkOpen = () => {
                if (this.data_channel_opened) {
                    clearTimeout(timer)
                    resolve()
                } else {
                    setTimeout(checkOpen, 100)
                }
            }
            checkOpen()
        })
    }

    deal_array_buffer(buffer: ArrayBuffer): unknown {
        const view = new DataView(buffer)
        const header_1 = view.getUint16(0, true)
        const header_2 = view.getUint16(2, true)
        if (header_1 === 2 && header_2 === 0) {
            return this.deal_array_buffer_for_lidar(buffer.slice(4))
        } else {
            return this.deal_array_buffer_for_normal(buffer)
        }
    }

    deal_array_buffer_for_normal(buffer: ArrayBuffer): unknown {
        const view = new DataView(buffer)
        const header_length = view.getUint16(0, true)
        const json_data = buffer.slice(4, 4 + header_length)
        const binary_data = buffer.slice(4 + header_length)

        const decoded_json = JSON.parse(new TextDecoder().decode(json_data))
        const decoded_data = this.decoder.decode(binary_data, decoded_json.data)

        decoded_json.data.data = decoded_data
        return decoded_json
    }

    deal_array_buffer_for_lidar(buffer: ArrayBuffer): unknown {
        const view = new DataView(buffer)
        const header_length = view.getUint32(0, true)
        const json_data = buffer.slice(8, 8 + header_length)
        const binary_data = buffer.slice(8 + header_length)

        const decoded_json = JSON.parse(new TextDecoder().decode(json_data))
        const decoded_data = this.decoder.decode(binary_data, decoded_json.data)

        decoded_json.data.data = decoded_data
        return decoded_json
    }

    async disableTrafficSaving(enable: boolean): Promise<boolean> {
        const data = {
            req_type: "disable_traffic_saving",
            instruction: enable ? "on" : "off",
        }
        const response = await this.pub_sub.publish("", data, DATA_CHANNEL_TYPE.RTC_INNER_REQ)
        if (response.info?.execution === "ok") {
            console.log(`DisableTrafficSavings: ${data.instruction}`)
            return true
        }
        return false
    }

    switchVideoChannel(enable: boolean): void {
        this.pub_sub.publishWithoutCallback("", enable ? "on" : "off", DATA_CHANNEL_TYPE.VID)
        console.log(`Video channel: ${enable ? "on" : "off"}`)
    }

    switchAudioChannel(enable: boolean): void {
        this.pub_sub.publishWithoutCallback("", enable ? "on" : "off", DATA_CHANNEL_TYPE.AUD)
        console.log(`Audio channel: ${enable ? "on" : "off"}`)
    }

    set_decoder(decoder_type: string): void {
        if (!["libvoxel", "native"].includes(decoder_type)) {
            throw new Error("Invalid decoder type. Choose 'libvoxel' or 'native'.")
        }
        this.decoder = new UnifiedLidarDecoder(decoder_type)
        console.log(`Decoder set to: ${this.decoder.get_decoder_name()}`)
    }
}
