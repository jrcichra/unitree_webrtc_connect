import { WebRTCDataChannel } from '../webrtc_datachannel';

export class WebRTCVideoChannel {
    pc: RTCPeerConnection;
    datachannel: WebRTCDataChannel | null = null;
    track_callbacks: ((track: MediaStreamTrack) => Promise<void>)[] = [];

    constructor(pc: RTCPeerConnection, datachannel: WebRTCDataChannel | null = null) {
        this.pc = pc;
        this.datachannel = datachannel;

        // Note: transceiver will be added in the driver to control order
    }

    setDataChannel(datachannel: WebRTCDataChannel): void {
        this.datachannel = datachannel;
    }

    switchVideoChannel(enable: boolean): void {
        if (this.datachannel) {
            this.datachannel.switchVideoChannel(enable);
        }
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
