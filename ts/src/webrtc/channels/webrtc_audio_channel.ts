import { WebRTCDataChannel } from '../webrtc_datachannel';

// Audio channel implementation
export class WebRTCAudioChannel {
    pc: RTCPeerConnection;
    datachannel: WebRTCDataChannel | null = null;
    track_callbacks: ((frame: any) => Promise<void>)[] = [];
    audioContext: AudioContext | null = null;
    source: MediaStreamAudioSourceNode | null = null;
    processor: ScriptProcessorNode | null = null;
    audioTrack: MediaStreamTrack | null = null;

    constructor(pc: RTCPeerConnection, datachannel: WebRTCDataChannel | null = null) {
        this.pc = pc;
        this.datachannel = datachannel;

        // Note: transceiver will be added in the driver to control order
    }

    setDataChannel(datachannel: WebRTCDataChannel): void {
        this.datachannel = datachannel;
    }

    async setupAudioProcessing(track: MediaStreamTrack): Promise<void> {
        this.audioTrack = track;

        // Check if AudioContext is available (browser environment)
        if (typeof AudioContext === 'undefined') {
            console.log("AudioContext not available, skipping audio processing");
            return;
        }

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
        if (this.datachannel) {
            this.datachannel.switchAudioChannel(enable);
        }
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
