export function discover_ip_sn(_timeout: number = 2): Record<string, string> {
    console.log("Discovering devices on the network...")

    // In browser environment, multicast UDP is not supported
    // Users need to provide IP address manually for LocalSTA mode
    console.warn("Multicast scanning is not supported in browser environment. Please provide IP address manually.")
    return {}
}
