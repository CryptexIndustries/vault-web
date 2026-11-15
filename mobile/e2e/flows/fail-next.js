// Makes the cloud fixture fail the next call to PROCEDURE once.
const response = http.post(`${CRYPTEX_E2E_CLOUD_URL}/fail-next`, {
    body: JSON.stringify({ path: PROCEDURE, message: MESSAGE, code: CODE }),
});
if (!response.ok) throw new Error(`Fixture answered ${response.status}.`);
