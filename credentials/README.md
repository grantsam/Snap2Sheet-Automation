# Credentials

Jangan menyimpan credential asli di repository.

- Mode OAuth: simpan client ID, client secret, dan refresh token sebagai environment variable.
- Mode service account: letakkan JSON sebagai `credentials/google-service-account.json` hanya pada mesin deployment.

Folder ini di-mount read-only oleh Docker Compose.
