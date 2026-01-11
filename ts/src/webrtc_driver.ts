import { WebRTCConnectionMethod } from './constants';
import { send_sdp_to_local_peer, send_sdp_to_remote_peer } from './unitree_auth';
import { WebRTCDataChannel } from './webrtc_datachannel';
import { fetch_public_key, fetch_turn_server_info, print_status } from './util';
import { discover_ip_sn } from './multicast_scanner';

// Audio channel implementation
class WebRTCAudioChannel {
    pc: RTCPeerConnection;
    datachannel: WebRTCDataChannel;
    track_callbacks: ((frame: any) => Promise<void>)[] = [];
    audioContext: AudioContext | null = null;
    source: MediaStreamAudioSourceNode | null = null;
    processor: ScriptProcessorNode | null = null;
    audioTrack: MediaStreamTrack | null = null;

    constructor(pc: RTCPeerConnection, datachannel: WebRTCDataChannel) {
        this.pc = pc;
        this.datachannel = datachannel;

        // Add audio transceiver
        this.pc.addTransceiver("audio", { direction: "sendrecv" });
    }

    async setupAudioProcessing(track: MediaStreamTrack): Promise<void> {
        this.audioTrack = track;
        this.audioContext = new AudioContext();
        const stream = new MediaStream([track]);
        this.source = this.audioContext.createMediaStreamSource(stream);

        // Create a script processor to get audio buffers
        this.processor = this.audioContext.createScriptProcessor(8192, 2, 2);
        this.processor.onaudioprocess = (event) => {
            // Create a frame-like object
            const frame = {
                to_ndarray: () => {
                    // Convert the audio buffer to Int16Array like the Python version
                    const buffer = event.inputBuffer;
                    const length = buffer.length * buffer.numberOfChannels;
                    const result = new Int16Array(length);
                    let index = 0;
                    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                        const channelData = buffer.getChannelData(channel);
                        for (let i = 0; i < buffer.length; i++) {
                            result[index++] = Math.max(-32768, Math.min(32767, channelData[i] * 32768));
                        }
                    }
                    return result;
                }
            };
            this.frame_handler(frame);
        };

        this.source.connect(this.processor);
        this.processor.connect(this.audioContext.destination);
    }

    async frame_handler(frame: any): Promise<void> {
        console.log("Receiving audio frame");

        // Trigger all registered callbacks
        for (const callback of this.track_callbacks) {
            try {
                await callback(frame);
            } catch (e) {
                console.error(`Error in callback: ${e}`);
            }
        }
    }

    add_track_callback(callback: (frame: any) => Promise<void>): void {
        if (typeof callback === 'function') {
            this.track_callbacks.push(callback);
        } else {
            console.warn(`Callback ${callback} is not callable.`);
        }
    }

    switchAudioChannel(enable: boolean): void {
        this.datachannel.switchAudioChannel(enable);
    }

    close(): void {
        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }
        if (this.source) {
            this.source.disconnect();
            this.source = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        if (this.audioTrack) {
            this.audioTrack.stop();
            this.audioTrack = null;
        }
    }
}

class WebRTCVideoChannel {
    pc: RTCPeerConnection;
    datachannel: WebRTCDataChannel;
    track_callbacks: ((track: MediaStreamTrack) => Promise<void>)[] = [];

    constructor(pc: RTCPeerConnection, datachannel: WebRTCDataChannel) {
        this.pc = pc;
        this.datachannel = datachannel;

        // Add video transceiver for receiving only
        this.pc.addTransceiver("video", { direction: "recvonly" });
    }

    switchVideoChannel(enable: boolean): void {
        this.datachannel.switchVideoChannel(enable);
    }

    add_track_callback(callback: (track: MediaStreamTrack) => Promise<void>): void {
        if (typeof callback === 'function') {
            this.track_callbacks.push(callback);
        } else {
            console.warn(`Callback ${callback} is not callable.`);
        }
    }

    async track_handler(track: MediaStreamTrack): Promise<void> {
        console.log("Receiving video frame");

        // Trigger all registered callbacks
        for (const callback of this.track_callbacks) {
            try {
                await callback(track);
            } catch (e) {
                console.error(`Error in callback: ${e}`);
            }
        }
    }
}

export class UnitreeWebRTCConnection {
    pc: RTCPeerConnection | null = null;
    sn: string | null;
    ip: string | null;
    connectionMethod: WebRTCConnectionMethod;
    isConnected: boolean = false;
    token: string = "";

    datachannel!: WebRTCDataChannel;
    audio!: WebRTCAudioChannel;
    video!: WebRTCVideoChannel;

    constructor(connectionMethod: WebRTCConnectionMethod, serialNumber?: string, ip?: string, username?: string, password?: string) {
        this.sn = serialNumber || null;
        this.ip = ip || null;
        this.connectionMethod = connectionMethod;
        if (username && password) {
            // Note: fetch_token is async, but constructor can't be async
            // We'll call it in connect()
        }
    }

    async connect(): Promise<void> {
        print_status("WebRTC connection", "🟡 started");
        if (this.connectionMethod === WebRTCConnectionMethod.Remote) {
            const public_key = await fetch_public_key();
            if (!public_key) throw new Error("Failed to fetch public key");
            const turn_server_info = await fetch_turn_server_info(this.sn!, this.token, public_key);
            await this.init_webrtc(turn_server_info);
        } else if (this.connectionMethod === WebRTCConnectionMethod.LocalSTA) {
            if (!this.ip && this.sn) {
                const discovered_ip_sn_addresses = discover_ip_sn();
                if (discovered_ip_sn_addresses && this.sn in discovered_ip_sn_addresses) {
                    this.ip = discovered_ip_sn_addresses[this.sn];
                } else {
                    throw new Error("The provided serial number wasn't found on the network. Provide an IP address instead.");
                }
            }
            await this.init_webrtc(this.ip);
        } else if (this.connectionMethod === WebRTCConnectionMethod.LocalAP) {
            this.ip = "192.168.12.1";
            await this.init_webrtc(this.ip);
        }
    }

    async disconnect(): Promise<void> {
        if (this.audio) {
            this.audio.close();
        }
        if (this.pc) {
            await this.pc.close();
            this.pc = null;
        }
        this.isConnected = false;
        print_status("WebRTC connection", "🔴 disconnected");
    }

    async reconnect(): Promise<void> {
        await this.disconnect();
        await this.connect();
        print_status("WebRTC connection", "🟢 reconnected");
    }

    create_webrtc_configuration(turn_server_info?: any, stunEnable: boolean = true, turnEnable: boolean = true): RTCConfiguration {
        const ice_servers: RTCIceServer[] = [];

        if (turn_server_info) {
            const username = turn_server_info.user;
            const credential = turn_server_info.passwd;
            const turn_url = turn_server_info.realm;

            if (username && credential && turn_url) {
                if (turnEnable) {
                    ice_servers.push({
                        urls: [turn_url],
                        username,
                        credential
                    });
                }
                if (stunEnable) {
                    ice_servers.push({
                        urls: "stun:stun.l.google.com:19302"
                    });
                }
            } else {
                throw new Error("Invalid TURN server information");
            }
        }

        return {
            iceServers: ice_servers
        };
    }

    async init_webrtc(turn_server_info?: any, ip?: string): Promise<void> {
        const configuration = this.create_webrtc_configuration(turn_server_info);
        this.pc = new RTCPeerConnection(configuration);

        this.datachannel = new WebRTCDataChannel(this, this.pc!);
        this.audio = new WebRTCAudioChannel(this.pc!, this.datachannel);
        this.video = new WebRTCVideoChannel(this.pc!, this.datachannel);

        this.pc.onicegatheringstatechange = () => {
            const state = this.pc!.iceGatheringState;
            if (state === "new") {
                print_status("ICE Gathering State", "🔵 new");
            } else if (state === "gathering") {
                print_status("ICE Gathering State", "🟡 gathering");
            } else if (state === "complete") {
                print_status("ICE Gathering State", "🟢 complete");
            }
        };

        this.pc.oniceconnectionstatechange = () => {
            const state = this.pc!.iceConnectionState;
            if (state === "checking") {
                print_status("ICE Connection State", "🔵 checking");
            } else if (state === "completed") {
                print_status("ICE Connection State", "🟢 completed");
            } else if (state === "failed") {
                print_status("ICE Connection State", "🔴 failed");
            } else if (state === "closed") {
                print_status("ICE Connection State", "⚫ closed");
            }
        };

        this.pc.onconnectionstatechange = () => {
            const state = this.pc!.connectionState;
            if (state === "connecting") {
                print_status("Peer Connection State", "🔵 connecting");
            } else if (state === "connected") {
                this.isConnected = true;
                print_status("Peer Connection State", "🟢 connected");
            } else if (state === "closed") {
                this.isConnected = false;
                print_status("Peer Connection State", "⚫ closed");
            } else if (state === "failed") {
                print_status("Peer Connection State", "🔴 failed");
            }
        };

        this.pc.onsignalingstatechange = () => {
            const state = this.pc!.signalingState;
            if (state === "stable") {
                print_status("Signaling State", "🟢 stable");
            } else if (state === "have-local-offer") {
                print_status("Signaling State", "🟡 have-local-offer");
            } else if (state === "have-remote-offer") {
                print_status("Signaling State", "🟡 have-remote-offer");
            } else if (state === "closed") {
                print_status("Signaling State", "⚫ closed");
            }
        };

        this.pc.ontrack = async (event) => {
            console.log("Track received:", event.track.kind);

            if (event.track.kind === "video") {
                await this.video.track_handler(event.track);
            }

            if (event.track.kind === "audio") {
                console.log("Audio track received");
                await this.audio.setupAudioProcessing(event.track);
            }
        };

        console.log("Creating offer...");
        const offer = await this.pc!.createOffer();
        await this.pc!.setLocalDescription(offer);

        let peer_answer_json: string | null = null;
        if (this.connectionMethod === WebRTCConnectionMethod.Remote) {
            peer_answer_json = await this.get_answer_from_remote_peer(this.pc!, turn_server_info);
        } else if (this.connectionMethod === WebRTCConnectionMethod.LocalSTA || this.connectionMethod === WebRTCConnectionMethod.LocalAP) {
            peer_answer_json = await this.get_answer_from_local_peer(this.pc!, this.ip!);
        }

        if (peer_answer_json) {
            const peer_answer = JSON.parse(peer_answer_json);
            if (peer_answer.sdp === "reject") {
                console.log("Go2 is connected by another WebRTC client. Close your mobile APP and try again.");
                throw new Error("Connection rejected");
            }

            const remote_sdp = new RTCSessionDescription({ sdp: peer_answer.sdp, type: peer_answer.type });
            await this.pc!.setRemoteDescription(remote_sdp);
        } else {
            throw new Error("Could not get SDP from the peer. Check if the Go2 is switched on");
        }

        await this.datachannel.wait_datachannel_open();
    }

    async get_answer_from_remote_peer(pc: RTCPeerConnection, turn_server_info?: any): Promise<string | null> {
        const sdp_offer = pc.localDescription!;
        const public_key = await fetch_public_key();
        if (!public_key) return null;

        const sdp_offer_json = {
            id: "",
            turnserver: turn_server_info,
            sdp: sdp_offer.sdp,
            type: sdp_offer.type,
            token: this.token
        };

        console.log("Local SDP created:", sdp_offer_json);

        return await send_sdp_to_remote_peer(this.sn!, JSON.stringify(sdp_offer_json), this.token, public_key);
    }

    async get_answer_from_local_peer(pc: RTCPeerConnection, ip: string): Promise<string | null> {
        const sdp_offer = pc.localDescription!;

        const sdp_offer_json = {
            id: this.connectionMethod === WebRTCConnectionMethod.LocalSTA ? "STA_localNetwork" : "",
            sdp: sdp_offer.sdp,
            type: sdp_offer.type,
            token: this.token
        };

        return await send_sdp_to_local_peer(ip, JSON.stringify(sdp_offer_json));
    }
}
