#!/bin/bash

docker run -d --restart always --network=host --name cryptex-vault-stun-turn -e DETECT_EXTERNAL_IP=yes -e DETECT_EXTERNAL_IPV6=yes coturn/coturn:4.6-alpine -n --log-file=stdout --min-port=49152 --max-port=65535 --listening-port=3478 --tls-listening-port=5349 --fingerprint --no-multicast-peers --no-tlsv1 --no-tlsv1_1 --no-cli --no-rfc5780 --no-stun-backward-compatibility --response-origin-only-with-rfc5780 
    # --cert=/etc/coturn/certs/example.com.pem
    # --pkey=/etc/coturn/certs/example.com.pk.pem
    # --relay-ip=68.183.212.181
    # --relay-ip=2a03:b0c0:3:d0::f5d:1001
    # --external-ip=68.183.212.181
    # --external-ip=2a03:b0c0:3:d0::f5d:1001



# Original production command
#docker run -d --restart always --network=host   -e DETECT_EXTERNAL_IP=yes   -e DETECT_EXTERNAL_IPV6=yes   -v /root/certs/:/etc/coturn/certs/ coturn/coturn:4.6-alpine -n         --log-file=stdout         --min-port=49152 --max-port=65535       --listening-port=3478 --tls-listening-port=5349         --fingerprint   --no-multicast-peers    --no-tlsv1 --no-tlsv1_1  --no-cli         --no-rfc5780    --no-stun-backward-compatibility        --response-origin-only-with-rfc5780     --cert=/etc/coturn/certs/example.com.pem        --pkey=/etc/coturn/certs/example.com.pk.pem   --relay-ip=68.183.212.181   --relay-ip=2a03:b0c0:3:d0::f5d:1001   --external-ip=68.183.212.181   --external-ip=2a03:b0c0:3:d0::f5d:1001
