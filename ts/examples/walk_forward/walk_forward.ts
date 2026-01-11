import { UnitreeWebRTCConnection, WebRTCConnectionMethod, RTC_TOPIC, MCF_CMD } from '../../src/index.js';

// Note: This example assumes RTCPeerConnection is available (e.g., in browser or with wrtc polyfill in Node.js)

async function main() {
    try {
        const conn = new UnitreeWebRTCConnection(WebRTCConnectionMethod.LocalSTA, undefined, "10.0.0.207");
        // conn = new UnitreeWebRTCConnection(WebRTCConnectionMethod.LocalSTA, "B42D2000XXXXXXXX");
        // conn = new UnitreeWebRTCConnection(WebRTCConnectionMethod.Remote, "B42D2000XXXXXXXX", "email@gmail.com", "pass");
        // conn = new UnitreeWebRTCConnection(WebRTCConnectionMethod.LocalAP);

        await conn.connect();

        console.log("Making the dog walk forward for 1 second...");

        // Send move forward command
        await conn.datachannel.pub_sub.publishRequestNew(RTC_TOPIC.MCF_CMD, {
            api_id: MCF_CMD.Move.toString(),
            parameter: { x: 0.2, y: 0, z: 0 }
        });

        // Wait 1 second
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Stop movement
        await conn.datachannel.pub_sub.publishRequestNew(RTC_TOPIC.MCF_CMD, {
            api_id: MCF_CMD.Damp.toString()
        });

        console.log("Walk forward completed.");

        // Keep the connection alive briefly
        await new Promise(() => setTimeout(() => process.exit(0), 2000));

    } catch (error) {
        console.error(error);
    }
}

main().catch(console.error);
