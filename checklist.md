# Checklist
- [ ] Clear out the TODOs
- [ ] Clear out the FIXMEs

- [x] Storing WebRTC (STUN/TURN) configuration
    - STUN
        - Need to store URLs only, no authentication
        - iceServers -> "urls"
    - TURN
        - iceServers -> "urls"
        - iceServers -> "username"
        - iceServers -> "credential"
    - General
        - Certificates
- [x] Storing Signaling (Pusher - WebSocket) configuration
    - App Key
    - Host
    - ServicePort
    - SecureServicePort
    -- ForceTLS
    -- EnabledTransports (ws, wss)
        - NOTE: Maybe we shouldn't specify the enabled transports as it is a whitelist (the library should be able to select the optimal transport protocol)
    - [x] UserAuth
    - [x] ChannelAuth

## Figure out

## Optimize

