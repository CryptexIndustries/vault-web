#!/usr/bin/env bash
# Regenerates the SSH key fixtures. These are throwaway test keys.
# Requires OpenSSH 9+ and OpenSSL 3.
set -euo pipefail
cd "$(dirname "$0")"
rm -f -- *.key *.pub
PASS="correct horse"

keygen() { ssh-keygen -q "$@"; }

# OpenSSH format
keygen -t ed25519 -N "" -C "ed25519@fixtures" -f ed25519.key
keygen -t ed25519 -N "$PASS" -C "ed25519-enc@fixtures" -f ed25519-aes256-ctr.key
keygen -t ed25519 -N "$PASS" -Z aes256-gcm@openssh.com -C "gcm@fixtures" -f ed25519-aes256-gcm.key
keygen -t ed25519 -N "$PASS" -Z aes256-cbc -C "cbc@fixtures" -f ed25519-aes256-cbc.key
keygen -t ed25519 -N "$PASS" -Z chacha20-poly1305@openssh.com -C "chacha@fixtures" -f ed25519-chacha.key
keygen -t ecdsa -b 256 -N "" -C "p256@fixtures" -f ecdsa-p256.key
keygen -t ecdsa -b 384 -N "$PASS" -C "p384@fixtures" -f ecdsa-p384-enc.key
keygen -t ecdsa -b 521 -N "" -C "p521@fixtures" -f ecdsa-p521.key
keygen -t rsa -b 3072 -N "" -C "rsa3072@fixtures" -f rsa-3072.key
keygen -t rsa -b 2048 -N "$PASS" -C "rsa2048@fixtures" -f rsa-2048-enc.key
keygen -t rsa -b 1024 -N "" -C "rsa1024@fixtures" -f rsa-1024.key

# PEM: PKCS#1 and SEC1, plain and with legacy OpenSSL encryption
keygen -t rsa -b 2048 -m PEM -N "" -f rsa-pkcs1.key
keygen -t rsa -b 2048 -m PEM -N "$PASS" -f rsa-pkcs1-enc.key
keygen -t ecdsa -b 256 -m PEM -N "" -f ecdsa-sec1.key
keygen -t ecdsa -b 384 -m PEM -N "$PASS" -f ecdsa-sec1-enc.key
openssl ec -in ecdsa-sec1.key -no_public -out ecdsa-sec1-nopub.key 2>/dev/null
cp ecdsa-sec1.key.pub ecdsa-sec1-nopub.key.pub
openssl rsa -in rsa-pkcs1.key -des3 -passout "pass:$PASS" -traditional -out rsa-pkcs1-3des.key 2>/dev/null
cp rsa-pkcs1.key.pub rsa-pkcs1-3des.key.pub

# PKCS#8, plain and PBES2
keygen -t rsa -b 2048 -m PKCS8 -N "" -f rsa-pkcs8.key
keygen -t ecdsa -b 521 -m PKCS8 -N "$PASS" -f ecdsa-pkcs8-enc.key
openssl genpkey -algorithm ed25519 -out ed25519-pkcs8.key
openssl pkcs8 -topk8 -in ed25519-pkcs8.key -v2 aes-256-cbc -v2prf hmacWithSHA512 -passout "pass:$PASS" -out ed25519-pkcs8-enc.key
ssh-keygen -y -f ed25519-pkcs8.key > ed25519-pkcs8.key.pub
cp ed25519-pkcs8.key.pub ed25519-pkcs8-enc.key.pub

# Unsupported inputs
openssl genrsa -traditional -out rsa-512.key 512 2>/dev/null
openssl dsaparam -genkey -noout -out dsa-pkcs8.key 2048 2>/dev/null
openssl pkey -in dsa-pkcs8.key -traditional -out dsa.key
# dsa-pkcs8.key stays: DSA in PKCS#8 form

chmod 600 -- *.key
