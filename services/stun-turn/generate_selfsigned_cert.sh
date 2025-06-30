#!/bin/bash
echo -e "Generating a self-signed certificate..."
openssl req -x509 -nodes -newkey ec -pkeyopt ec_paramgen_curve:secp384r1 -keyout ec_key.pem -out ec_cert.pem -subj /C=HR/ST=State/L=Locality/O=Organization/CN=example.com -days 365

echo -e "Setting key permissions..."
chmod 644 ec_key.pem

# If there was no problem, echo a success message
if [ $? -eq 0 ]; then
    echo -e "Done."
else
    echo -e "Failed to generate a self-signed certificate."
fi
