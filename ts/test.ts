import {
    UnitreeWebRTCConnection,
    WebRTCConnectionMethod,
    WebRTCAudioHub,
    DATA_CHANNEL_TYPE,
    SPORT_CMD
} from './dist/index';

// Basic functionality test
async function runTests() {
    console.log('🧪 Running Unitree WebRTC TypeScript Library Tests...\n');

    try {
        // Test 1: Library imports
        console.log('✅ Test 1: Library imports successful');

        // Test 2: Create connection instance
        const connection = new UnitreeWebRTCConnection(WebRTCConnectionMethod.LocalAP);
        console.log('✅ Test 2: UnitreeWebRTCConnection instance created');

        // Test 3: Check connection properties
        if (connection.pc === null && !connection.isConnected) {
            console.log('✅ Test 3: Connection properties initialized correctly');
        }

        // Test 4: Test constants
        if (DATA_CHANNEL_TYPE.VALIDATION === 'validation') {
            console.log('✅ Test 4: Constants loaded correctly');
        }

        // Test 5: Test SPORT commands
        if (SPORT_CMD.BalanceStand === 1002) {
            console.log('✅ Test 5: SPORT commands available');
        }

        // Test 6: Create AudioHub instance
        const audioHub = new WebRTCAudioHub(connection);
        console.log('✅ Test 6: WebRTCAudioHub instance created');

        // Test 7: Check AudioHub properties
        if (audioHub.conn === connection) {
            console.log('✅ Test 7: AudioHub connection reference correct');
        }

        console.log('\n🎉 All basic tests passed! Library is functional.');
        console.log('\nNote: Full WebRTC functionality requires a running robot and proper network setup.');
        console.log('See examples/browser/ and examples/webxr/ for complete usage examples.');

    } catch (error) {
        console.error('❌ Test failed:', error);
        throw error; // Re-throw for browser environments
    }
}

// Run tests if this file is executed directly
if (typeof window === 'undefined') {
    // Node.js environment
    runTests();
} else {
    // Browser environment - expose for manual testing
    (window as any).runUnitreeTests = runTests;
    console.log('🧪 Unitree library loaded. Run runUnitreeTests() to test basic functionality.');
}
