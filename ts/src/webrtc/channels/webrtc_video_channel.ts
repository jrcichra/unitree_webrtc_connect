import { WebRTCDataChannel } from '../webrtc_datachannel';

export class WebRTCVideoChannel {
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
