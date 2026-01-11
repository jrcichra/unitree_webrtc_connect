# Unitree WebRTC Connect TypeScript

A TypeScript library for connecting to Unitree Go2 and G1 robots via WebRTC, designed for websites and WebXR applications.

## Features

- **Browser-compatible**: Uses native WebRTC APIs for seamless integration with web applications
- **Multiple connection methods**: Local AP, Local STA, and Remote connections through Unitree servers
- **Video and Audio streaming**: Control and receive video/audio streams from the robot
- **Data channel communication**: Send commands and receive sensor data
- **WebXR ready**: Perfect for VR interfaces and immersive experiences

## Installation

```bash
npm install unitree-webrtc-connect-ts
```

## Quick Start

```typescript
import {
  UnitreeWebRTCConnection,
  WebRTCConnectionMethod,
} from "unitree-webrtc-connect-ts";

// Create connection
const connection = new UnitreeWebRTCConnection(
  WebRTCConnectionMethod.LocalSTA,
  undefined, // serial number (for remote)
  "192.168.1.100", // IP address
  undefined, // username (for remote)
  undefined // password (for remote)
);

// Connect
await connection.connect();

// Enable video
connection.datachannel.switchVideoChannel(true);

// Handle video stream
connection.pc.ontrack = (event) => {
  if (event.track.kind === "video") {
    const videoElement = document.getElementById("video");
    videoElement.srcObject = new MediaStream([event.track]);
  }
};

// Disconnect when done
await connection.disconnect();
```

## Connection Methods

### Local AP Mode

Connect directly when the robot is in AP mode:

```typescript
const connection = new UnitreeWebRTCConnection(WebRTCConnectionMethod.LocalAP);
```

### Local STA Mode

Connect to robot on the same network:

```typescript
const connection = new UnitreeWebRTCConnection(
  WebRTCConnectionMethod.LocalSTA,
  undefined,
  "192.168.1.100" // Robot's IP address
);
```

### Remote Mode

Connect through Unitree's servers (requires account):

```typescript
const connection = new UnitreeWebRTCConnection(
  WebRTCConnectionMethod.Remote,
  "B42D2000XXXXXXXX", // Serial number
  undefined,
  "your@email.com", // Username
  "password" // Password
);
```

## API Reference

### UnitreeWebRTCConnection

Main connection class.

**Methods:**

- `connect()`: Establish WebRTC connection
- `disconnect()`: Close connection
- `reconnect()`: Reconnect to robot

**Properties:**

- `datachannel`: WebRTCDataChannel instance for data communication
- `audio`: WebRTCAudioChannel instance (stub)
- `video`: WebRTCVideoChannel instance (stub)
- `isConnected`: Connection status

### WebRTCDataChannel

Handles data channel communication and control.

**Methods:**

- `switchVideoChannel(enable: boolean)`: Enable/disable video stream
- `switchAudioChannel(enable: boolean)`: Enable/disable audio stream
- `disableTrafficSaving(enable: boolean)`: Control traffic saving mode

## Examples

See `examples/browser/index.html` for a complete browser-based example with UI controls.

## Browser Compatibility

- Chrome 72+
- Firefox 65+
- Safari 12+
- Edge 79+

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# The built library is in dist/
```

## Limitations

- Multicast discovery is not supported in browsers (provide IP manually for Local STA mode)
- Some advanced audio/video features are stubbed and need further implementation
- LiDAR decoding requires additional work for full functionality

## License

MIT License (same as original Python library)

## Contributing

Contributions welcome! This is a port of the Python library, and many features can be further developed.

## Original Python Library

This is a TypeScript port of [unitree_webrtc_connect](https://github.com/jrcichra/unitree_webrtc_connect) by jrcichra.
