import { WebRTCConnectionMethod } from "../constants"
import { send_sdp_to_local_peer, send_sdp_to_remote_peer } from "../auth/unitree_auth"
import { WebRTCDataChannel } from "./webrtc_datachannel"
import { fetch_public_key, fetch_turn_server_info, print_status } from "../core/util"
import { discover_ip_sn } from "../network/multicast_scanner"
import { WebRTCAudioChannel } from "./channels/webrtc_audio_channel"
import { WebRTCVideoChannel } from "./channels/webrtc_video_channel"

export class UnitreeWebRTCConnection {
    pc: RTCPeerConnection | null = null
    sn: string | null
    ip: string | null
    connectionMethod: WebRTCConnectionMethod
    isConnected: boolean = false
    token: string = ""

    datachannel!: WebRTCDataChannel
    audio!: WebRTCAudioChannel
    video!: WebRTCVideoChannel

    constructor(
        connectionMethod: WebRTCConnectionMethod,
        serialNumber?: string,
        ip?: string,
        username?: string,
        password?: string
    ) {
        this.sn = serialNumber || null
        this.ip = ip || null
        this.connectionMethod = connectionMethod
        if (username && password) {
            // Note: fetch_token is async, but constructor can't be async
            // We'll call it in connect()
        }
    }

    async connect(): Promise<void> {
        print_status("WebRTC connection", "🟡 started")
        if (this.connectionMethod === WebRTCConnectionMethod.Remote) {
            const public_key = await fetch_public_key()
            if (!public_key) throw new Error("Failed to fetch public key")
            const turn_server_info = await fetch_turn_server_info(this.sn!, this.token, public_key)
            await this.init_webrtc(turn_server_info)
        } else if (this.connectionMethod === WebRTCConnectionMethod.LocalSTA) {
            if (!this.ip && this.sn) {
                const discovered_ip_sn_addresses = discover_ip_sn()
                if (discovered_ip_sn_addresses && this.sn in discovered_ip_sn_addresses) {
                    this.ip = discovered_ip_sn_addresses[this.sn]
                } else {
                    throw new Error(
                        "The provided serial number wasn't found on the network. Provide an IP address instead."
                    )
                }
            }
            await this.init_webrtc(this.ip)
        } else if (this.connectionMethod === WebRTCConnectionMethod.LocalAP) {
            this.ip = "192.168.12.1"
            await this.init_webrtc(this.ip)
        }
    }

    async disconnect(): Promise<void> {
        if (this.audio) {
            this.audio.close()
        }
        if (this.pc) {
            await this.pc.close()
            this.pc = null
        }
        this.isConnected = false
        print_status("WebRTC connection", "🔴 disconnected")
    }

    async reconnect(): Promise<void> {
        await this.disconnect()
        await this.connect()
        print_status("WebRTC connection", "🟢 reconnected")
    }

    create_webrtc_configuration(
        turn_server_info?: any,
        stunEnable: boolean = true,
        turnEnable: boolean = true
    ): RTCConfiguration {
        const ice_servers: RTCIceServer[] = []

        if (turn_server_info) {
            const username = turn_server_info.user
            const credential = turn_server_info.passwd
            const turn_url = turn_server_info.realm

            if (username && credential && turn_url) {
                if (turnEnable) {
                    ice_servers.push({
                        urls: [turn_url],
                        username,
                        credential,
                    })
                }
                if (stunEnable) {
                    ice_servers.push({
                        urls: "stun:stun.l.google.com:19302",
                    })
                }
            } else {
                throw new Error("Invalid TURN server information")
            }
        }

        return {
            iceServers: ice_servers,
        }
    }

    async init_webrtc(turn_server_info?: any, _ip?: string): Promise<void> {
        const configuration = this.create_webrtc_configuration(turn_server_info)
        this.pc = new RTCPeerConnection(configuration)

        this.datachannel = new WebRTCDataChannel(this, this.pc!)
        this.audio = new WebRTCAudioChannel(this.pc!, this.datachannel)
        this.video = new WebRTCVideoChannel(this.pc!, this.datachannel)

        this.pc.onicegatheringstatechange = () => {
            const state = this.pc!.iceGatheringState
            if (state === "new") {
                print_status("ICE Gathering State", "🔵 new")
            } else if (state === "gathering") {
                print_status("ICE Gathering State", "🟡 gathering")
            } else if (state === "complete") {
                print_status("ICE Gathering State", "🟢 complete")
            }
        }

        this.pc.oniceconnectionstatechange = () => {
            const state = this.pc!.iceConnectionState
            if (state === "checking") {
                print_status("ICE Connection State", "🔵 checking")
            } else if (state === "completed") {
                print_status("ICE Connection State", "🟢 completed")
            } else if (state === "failed") {
                print_status("ICE Connection State", "🔴 failed")
            } else if (state === "closed") {
                print_status("ICE Connection State", "⚫ closed")
            }
        }

        this.pc.onconnectionstatechange = () => {
            const state = this.pc!.connectionState
            if (state === "connecting") {
                print_status("Peer Connection State", "🔵 connecting")
            } else if (state === "connected") {
                this.isConnected = true
                print_status("Peer Connection State", "🟢 connected")
            } else if (state === "closed") {
                this.isConnected = false
                print_status("Peer Connection State", "⚫ closed")
            } else if (state === "failed") {
                print_status("Peer Connection State", "� failed")
            }
        }

        this.pc.onsignalingstatechange = () => {
            const state = this.pc!.signalingState
            if (state === "stable") {
                print_status("Signaling State", "🟢 stable")
            } else if (state === "have-local-offer") {
                print_status("Signaling State", "🟡 have-local-offer")
            } else if (state === "have-remote-offer") {
                print_status("Signaling State", "🟡 have-remote-offer")
            } else if (state === "closed") {
                print_status("Signaling State", "⚫ closed")
            }
        }

        this.pc.ontrack = async (event) => {
            console.log("Track received:", event.track.kind)

            if (event.track.kind === "video") {
                await this.video.track_handler(event.track)
            }

            if (event.track.kind === "audio") {
                console.log("Audio track received")
                await this.audio.setupAudioProcessing(event.track)
            }
        }

        console.log("Creating offer...")
        const offer = await this.pc!.createOffer()
        await this.pc!.setLocalDescription(offer)

        let peer_answer_json: string | null = null
        if (this.connectionMethod === WebRTCConnectionMethod.Remote) {
            peer_answer_json = await this.get_answer_from_remote_peer(this.pc!, turn_server_info)
        } else if (
            this.connectionMethod === WebRTCConnectionMethod.LocalSTA ||
            this.connectionMethod === WebRTCConnectionMethod.LocalAP
        ) {
            peer_answer_json = await this.get_answer_from_local_peer(this.pc!, this.ip!)
        }

        if (peer_answer_json) {
            const peer_answer = JSON.parse(peer_answer_json)
            if (peer_answer.sdp === "reject") {
                console.log("Go2 is connected by another WebRTC client. Close your mobile APP and try again.")
                throw new Error("Connection rejected")
            }

            const remote_sdp = new RTCSessionDescription({ sdp: peer_answer.sdp, type: peer_answer.type })
            await this.pc!.setRemoteDescription(remote_sdp)
        } else {
            throw new Error("Could not get SDP from the peer. Check if the Go2 is switched on")
        }

        await this.datachannel.wait_datachannel_open()
    }

    async get_answer_from_remote_peer(pc: RTCPeerConnection, turn_server_info?: any): Promise<string | null> {
        const sdp_offer = pc.localDescription!
        const public_key = await fetch_public_key()
        if (!public_key) return null

        const sdp_offer_json = {
            id: "",
            turnserver: turn_server_info,
            sdp: sdp_offer.sdp,
            type: sdp_offer.type,
            token: this.token,
        }

        console.log("Local SDP created:", sdp_offer_json)

        return await send_sdp_to_remote_peer(this.sn!, JSON.stringify(sdp_offer_json), this.token, public_key)
    }

    async get_answer_from_local_peer(pc: RTCPeerConnection, ip: string): Promise<string | null> {
        const sdp_offer = pc.localDescription!

        const sdp_offer_json = {
            id: this.connectionMethod === WebRTCConnectionMethod.LocalSTA ? "STA_localNetwork" : "",
            sdp: sdp_offer.sdp,
            type: sdp_offer.type,
            token: this.token,
        }

        return await send_sdp_to_local_peer(ip, JSON.stringify(sdp_offer_json))
    }
}
