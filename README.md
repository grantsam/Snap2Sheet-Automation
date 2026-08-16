# ⚡ Snap2Sheet Automation Hub

> **Automated WhatsApp Group to Google Drive & Google Sheets Pipeline.**  
> Built for operational field teams to seamlessly stream photo albums and structured reports directly into Google Sheets and Google Drive with zero manual data entry.

---

## 🌟 Key Features

- 🖥️ **Modern Desktop Web Dashboard (`http://localhost:3500`)**  
  Built with **shadcn Dark Theme (Zinc)** tokens + responsive mobile/desktop layout.
- 📁 **Multi-Project & Multi-Sheet Architecture**  
  Manage multiple Google Drive folders, spreadsheets, and WhatsApp groups from one unified interface without editing `.env` manually.
- 🪄 **5-Step Interactive Project Wizard**  
  Live Google Sheets & Drive URL ID parser + **1-Click OAuth 2.0 Token Capture**.
- 🔲 **High-Resolution Vector WhatsApp QR Modal**  
  Dedicated, crystal-clear QR scan popup dialog that connects in seconds and auto-dismisses upon pairing.
- 🥷 **Stealth / Passive Bot Operation**  
  Processes reports silently in WhatsApp without sending intrusive direct messages (DMs) to field technicians or clients.
- 🔔 **Real-Time Notification Feed & DevTools Console**  
  Live event stream of every report completed, draft status, and sync activity with unread badge counter.
- 🔄 **Backwards Sliding Window Auto-Sync**  
  Scans and processes reports that were sent while the bot was offline or asleep, cross-referencing Google Sheets to prevent duplicate entries.
- 🖼️ **Automated Drive Folders & Sheets `=IMAGE(...)` Previews**  
  Creates organized customer folders in Google Drive and writes thumbnail preview formulas into Google Sheets automatically.

---

## 📊 Google Sheets Output Format

Each completed 6-photo report appends a structured row to your worksheet:

| No. | Tanggal | Nama Pelanggan | Alamat | Nomor Registrasi | Berita Acara | Isometris | Dokumentasi 1 | Dokumentasi 2 | Dokumentasi 3 | Dokumentasi 4 |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | 2026-08-16 | Grant | Jl. Mawar No. 12 | 1234 | `=IMAGE(...)` | `=IMAGE(...)` | `=IMAGE(...)` | `=IMAGE(...)` | `=IMAGE(...)` | `=IMAGE(...)` |

> *Note: Drive links and image formulas use your authenticated Google credentials. Access remains secure and private.*

---

## 🚀 Quick Start (Windows 1-Click)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/Snap2Sheet-Automation.git
   cd Snap2Sheet-Automation
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Launch the Dashboard:**
   Double click **`Snap2Sheet.bat`** *(or run `npm run dashboard`)*.
   Your browser will automatically open:
   ```text
   http://localhost:3500
   ```

---

## 🛠️ Step-by-Step Setup Guide

### Step 1: Google Cloud Console Setup (OAuth 2.0)

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a new project.
2. Go to **APIs & Services → Library**, and enable:
   - **Google Drive API**
   - **Google Sheets API**
3. Go to **APIs & Services → Credentials**:
   - Click **Create Credentials → OAuth client ID**.
   - Application type: **Desktop App** (or Web Application with redirect URI `http://localhost:3001/oauth2callback`).
   - Copy your **Client ID** and **Client Secret**.

### Step 2: Target Google Sheet & Drive Folder

1. Create a Google Spreadsheet, name the worksheet tab (e.g. `Sheet1` or `Data`).
2. Leave Row 1 blank (Snap2Sheet will auto-generate headers) OR paste the 11 standard headers:
   ```text
   No. | Tanggal | Nama Pelanggan | Alamat | Nomor Registrasi | Berita Acara | Isometris | Dokumentasi 1 | Dokumentasi 2 | Dokumentasi 3 | Dokumentasi 4
   ```
3. Create a dedicated Google Drive folder (e.g. `Snap2Sheet Uploads`).

### Step 3: Configure Profile in Dashboard UI

1. Open the Dashboard (`http://localhost:3500`) and click **New Project**.
2. **Step 1 (Name):** Enter project identifier (e.g. `proyek-pipa-jakarta`).
3. **Step 2 (Auth):** Select **OAuth 2.0**, paste Client ID & Client Secret, then click **Authorize**. Sign in with Google to capture your Refresh Token in 1 click.
4. **Step 3 (Target):** Paste your full Google Spreadsheet URL and Google Drive Folder URL (IDs are parsed automatically).
5. **Step 4 (Route):** Enter your WhatsApp Group Name or Group ID (type `!idgrup` in WhatsApp to get it).
6. **Step 5 (Test):** Click **Run Diagnostics** to verify permissions, then click **Save Profile**.

### Step 4: Scan WhatsApp QR Code & Launch

1. Go to the **Bot Console** tab in the Dashboard.
2. Select your Project Profile and choose **Sync + Live**.
3. Click **Start Bot Client**.
4. A high-contrast QR Code popup will appear. Open **WhatsApp on your phone → Linked Devices → Link a Device**, and scan the QR code.
5. Once authenticated, the popup closes automatically and the bot starts monitoring!

---

## 📱 Field Reporting Instructions (Cara Kirim di WhatsApp)

Field technicians simply select **6 photos in WhatsApp** and send them in one of two easy methods:

### Method A (Recommended — 1-Shot with Caption)
1. Select 6 photos in WhatsApp.
2. On any photo (or the last photo), type the caption:
   ```text
   1234 grant
   ```
   *(or `0000 minz ( 1234 grant )` / `1234 - Grant`)*
3. Send! The bot automatically buffers the photos, uploads them to Google Drive, appends the row to Google Sheets, and logs the success in the Dashboard.

### Method B (Photos First, Text Follows)
1. Send 6 photos without caption.
2. Send a text message with the registration number and customer name:
   ```text
   1234 grant
   ```
3. The bot claims the 6 buffered photos and records the submission instantly.

---

## 🕹️ Operational Modes

| Mode | Description |
| :--- | :--- |
| **Sync + Live** *(Recommended)* | Automatically scans up to 500 past messages in the group to catch any reports submitted while the bot was offline, then transitions to real-time live monitoring. |
| **Live Only** | Starts monitoring incoming WhatsApp messages immediately without scanning historical chat logs. |
| **Sync Only** | Performs a one-time backwards scan of past group chat history, records unlogged submissions to Sheets, and terminates cleanly. |

---

## 💻 CLI Commands

| Command | Action |
| :--- | :--- |
| `npm run dashboard` | Launch Desktop Web Dashboard (Port 3500) |
| `npm run dev` | Run bot with nodemon/watch mode using `.env` |
| `npm test` | Run 19 automated unit and E2E simulation test suites |
| `npm run typecheck` | Run strict TypeScript compiler verification |
| `npm run doctor` | Run environment & connectivity diagnostics CLI |

---

## 🐳 Docker Deployment

For headless 24/7 VPS deployment:

```bash
# 1. Copy and configure .env
cp .env.example .env

# 2. Start container
docker compose up -d --build

# 3. View live logs & scan initial QR
docker compose logs -f snap2sheet
```

---

## 🔒 Security & Privacy

- **Zero Client Spam**: Bot operates in complete stealth mode on WhatsApp.
- **Local Credential Storage**: OAuth tokens and WhatsApp session keys are stored locally in `data/` and `projects/` (excluded from git via `.gitignore`).
- **Google IAM Scopes**: Only requires access to Google Drive and Google Sheets APIs.

---

## 📄 License

MIT © Snap2Sheet Automation Contributors.
