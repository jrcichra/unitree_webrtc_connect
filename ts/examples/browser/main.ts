import { UnitreeWebRTCConnection, WebRTCConnectionMethod } from '../../src/index.js';

let connection: UnitreeWebRTCConnection | null = null;

const connectionMethodSelect = document.getElementById('connectionMethod') as HTMLSelectElement;
const ipInput = document.getElementById('ip') as HTMLInputElement;
const serialInput = document.getElementById('serial') as HTMLInputElement;
const usernameInput = document.getElementById('username') as HTMLInputElement;
const passwordInput = document.getElementById('password') as HTMLInputElement;
const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnectBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const videoElement = document.getElementById('videoElement') as HTMLVideoElement;
const enableVideoBtn = document.getElementById('enableVideoBtn') as HTMLButtonElement;
const disableVideoBtn = document.getElementById('disableVideoBtn') as HTMLButtonElement;
const enableAudioBtn = document.getElementById('enableAudioBtn') as HTMLButtonElement;
const disableAudioBtn = document.getElementById('disableAudioBtn') as HTMLButtonElement;

// Show/hide form fields based on connection method
connectionMethodSelect.addEventListener('change', () => {
    const method = connectionMethodSelect.value;
    (document.getElementById('ipGroup') as HTMLDivElement).style.display = method === 'LocalSTA' ? 'block' : 'none';
    (document.getElementById('serialGroup') as HTMLDivElement).style.display = method === 'Remote' ? 'block' : 'none';
    (document.getElementById('usernameGroup') as HTMLDivElement).style.display = method === 'Remote' ? 'block' : 'none';
    (document.getElementById('passwordGroup') as HTMLDivElement).style.display = method === 'Remote' ? 'block' : 'none';
});

connectBtn.addEventListener('click', async () => {
    const method = connectionMethodSelect.value;
    let connectionMethod: WebRTCConnectionMethod;

    switch (method) {
        case 'LocalSTA':
            connectionMethod = WebRTCConnectionMethod.LocalSTA;
            break;
        case 'LocalAP':
            connectionMethod = WebRTCConnectionMethod.LocalAP;
            break;
        case 'Remote':
            connectionMethod = WebRTCConnectionMethod.Remote;
            break;
        default:
            alert('Invalid connection method');
            return;
    }

    try {
        connectBtn.disabled = true;
        connectBtn.textContent = 'Connecting...';

        connection = new UnitreeWebRTCConnection(
            connectionMethod,
            method === 'Remote' ? serialInput.value : undefined,
            method === 'LocalSTA' ? ipInput.value : undefined,
            method === 'Remote' ? usernameInput.value : undefined,
            method === 'Remote' ? passwordInput.value : undefined
        );

        await connection.connect();

        statusDiv.textContent = 'Connected';
        statusDiv.className = 'status connected';
        disconnectBtn.disabled = false;
        enableVideoBtn.disabled = false;
        enableAudioBtn.disabled = false;

        // Set up video stream
        if (connection.pc && connection.pc.ontrack) {
            connection.pc.ontrack = (event: RTCTrackEvent) => {
                if (event.track.kind === 'video') {
                    const stream = new MediaStream([event.track]);
                    videoElement.srcObject = stream;
                }
            };
        }

    } catch (error) {
        console.error('Connection failed:', error);
        alert('Connection failed: ' + (error as Error).message);
        statusDiv.textContent = 'Connection failed: ' + (error as Error).message;
        statusDiv.className = 'status disconnected';
    } finally {
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect';
    }
});

disconnectBtn.addEventListener('click', async () => {
    if (connection) {
        await connection.disconnect();
        connection = null;
        statusDiv.textContent = 'Disconnected';
        statusDiv.className = 'status disconnected';
        disconnectBtn.disabled = true;
        enableVideoBtn.disabled = true;
        disableVideoBtn.disabled = true;
        enableAudioBtn.disabled = true;
        disableAudioBtn.disabled = true;
        videoElement.srcObject = null;
    }
});

enableVideoBtn.addEventListener('click', () => {
    if (connection && connection.datachannel) {
        connection.datachannel.switchVideoChannel(true);
        enableVideoBtn.disabled = true;
        disableVideoBtn.disabled = false;
    }
});

disableVideoBtn.addEventListener('click', () => {
    if (connection && connection.datachannel) {
        connection.datachannel.switchVideoChannel(false);
        disableVideoBtn.disabled = true;
        enableVideoBtn.disabled = false;
    }
});

enableAudioBtn.addEventListener('click', () => {
    if (connection && connection.datachannel) {
        connection.datachannel.switchAudioChannel(true);
        enableAudioBtn.disabled = true;
        disableAudioBtn.disabled = false;
    }
});

disableAudioBtn.addEventListener('click', () => {
    if (connection && connection.datachannel) {
        connection.datachannel.switchAudioChannel(false);
        disableAudioBtn.disabled = true;
        enableAudioBtn.disabled = false;
    }
});
