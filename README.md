# VocaTechX

VocaTechX is an offline desktop toolkit for computer technicians and Computer
Systems Servicing (CSS) students on Windows. It puts the everyday jobs of a
technician in one app: diagnosing and repairing Windows, networks and printers,
installing software, and learning the trade with lessons, quizzes and an
interactive 3D hardware lab.

Everything runs on the computer itself. No internet connection or online
account is needed, and nothing is sent anywhere. That includes the AI assistant.

## Features

### Dashboard
- An overview of this computer (hardware, Windows, live CPU, memory and disk use).
- Your most recent repairs and diagnostics.

### AI Troubleshooter (Ralp)
- Describe a problem and chat with Ralp, an AI assistant that runs fully offline
  through a local llama.cpp server.
- Conversations are saved per account.
- Model files are imported from disk.

### Network Center
- Lists adapters with their IP configuration.
- Diagnoses connectivity step by step.
- Tests and compares DNS servers.
- Runs a performance test.
- Guided repairs: flush DNS, renew IP, reset Winsock/TCP-IP and more.
- File sharing: discover computers, browse and test shares, create or remove
  shares, and check SMB.
- Shows saved Wi-Fi passwords.

### Printer & Devices
- Printers and their status, plus the print spooler (status and repair).
- Stuck print queues, cleared safely.
- Connected hardware with its problem codes, and installed drivers.

### Windows Repair
- **System files & disk:**
  - Repair the Windows image (DISM)
  - Scan system files (SFC)
  - Check the disk (CHKDSK)
  - Schedule a memory test
- **Windows Update:**
  - Reset its components
  - Clear the download cache
  - Restart the update services
- **Startup & recovery:**
  - Create a restore point
  - Open System Restore
  - Restart to Advanced Startup
  - Turn Safe Mode on, and back to normal startup
- **Cleanup:**
  - Clear temporary files
  - Optimise drives (defrag for hard drives, TRIM for SSDs)
  - Rebuild the icon cache
  - Reset the Microsoft Store cache
- **Full system repair** runs restore point → DISM → SFC → CHKDSK in order.
- **Live progress:** each tool's output and progress percentage appear as it runs.
- **Results:** each repair is judged from what the tool actually reported.
- **Status:** Windows version, pending restart, Safe Mode, free space, disk
  health, restore points and the last memory test.

### Software Center
- Installs the apps you place in the [application/](application/) folder.
  Select several and install them in one go, with a progress window.
- Uninstalls and edits apps, and shows each app's icon.
- Installers are checked against their saved SHA-256 checksum before they run.

### CSS Learning Library
- 16 offline lessons with quizzes across 10 categories:
  - electrical safety and ESD
  - hardware fundamentals
  - assembly and disassembly
  - troubleshooting
  - Windows installation and recovery
  - networking
  - printers
  - preventive maintenance
  - tools
  - practical assessments
- **3D Hardware Lab:**
  - Take apart and rebuild a PC step by step: side panel, RAM, CPU, GPU, SSD,
    PSU and cables.
  - Hand and select tools, plus full screen.
  - An auto-demo shows each lesson before you try it.
- Lesson progress, bookmarks, quiz scores and lab results are saved per account.

### Activity Logs and reports
- Every diagnostic, repair and install is recorded in a local SQLite database.
- Each module has a history tab, and entries can be exported as TXT or PDF reports.

## Security and safety

- **Accounts:**
  - Passwords are hashed with Argon2id.
  - The session lives only in the backend.
  - Repeated failed logins lock the account for a while.
- **No arbitrary commands:**
  - The frontend can only call a fixed list of backend commands.
  - Windows tools run by their full System32 path with fixed arguments, never
    through a shell.
- **No surprises:**
  - The app never force-closes programs and never restarts the computer unless
    you choose to.
  - Long repairs are never killed halfway.
- **No fake results:**
  - Progress is shown only when a tool reports it.
  - Statuses Windows doesn't answer are shown as unknown, not guessed.
- **Clean software only:**
  - No cracked software, activators or keygens.
  - Nothing that turns off Windows security.

## Tech stack

### Desktop app

| Technology | Version | Used for |
|---|---|---|
| [Tauri](https://tauri.app) | 2.12 | Desktop shell: native window, secure bridge between the UI and Rust |
| [Rust](https://www.rust-lang.org) | 1.90+ (edition 2024) | Backend: system checks, repairs, installs, database, security |
| WebView2 | built into Windows | Renders the UI |

### Frontend ([src/](src/))

| Technology | Version | Used for |
|---|---|---|
| [React](https://react.dev) | 19.2 | User interface |
| [TypeScript](https://www.typescriptlang.org) | 6.0 | Type-safe frontend code |
| [Vite](https://vite.dev) | 8 | Dev server and bundler |
| [Tailwind CSS](https://tailwindcss.com) | 4.3 | Styling |
| [three.js](https://threejs.org) | 0.186 | 3D graphics for the Hardware Lab |
| [React Three Fiber](https://r3f.docs.pmnd.rs) | 9.8 | three.js as React components |
| [Zod](https://zod.dev) | 4.6 | Validates the lesson and quiz content |
| [Lucide](https://lucide.dev) | 1.57 | Icons |

### Backend ([src-tauri/](src-tauri/))

| Crate | Used for |
|---|---|
| `rusqlite` (bundled SQLite) | Local database for accounts, history, reports and progress, in `%APPDATA%\com.vocatechx.app\` |
| `argon2` | Password hashing (Argon2id) |
| `sha2` | SHA-256 checksums of Software Center installers |
| `sysinfo` | CPU, memory and disk information for the dashboard |
| `windows-sys` | Windows APIs for network adapters, Wi-Fi, file sharing, job objects and administrator checks |
| `serde` / `serde_json` | Data passed between the UI and the backend |
| `ureq` | Talks to the local AI server only (no internet calls) |
| `thiserror`, `log` | Error messages and logging |
| `tauri-plugin-dialog` | Save and open file dialogs (report export, picking folders) |

### Built-in Windows tools

These are the tools VocaTechX runs. All of them are part of Windows:

- DISM, SFC, CHKDSK, defrag
- bcdedit, shutdown
- PowerShell
- netsh, ipconfig
- System Restore (`rstrui`), WSReset, `ie4uinit`

### AI

| Technology | Used for |
|---|---|
| [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server`) | Runs Ralp's language model locally on the CPU |
| GGUF model files | The AI model, imported by the user |

### Testing and code quality

| Tool | Used for |
|---|---|
| [Vitest](https://vitest.dev) 5 | Frontend tests: lessons, quizzes, lab simulation |
| `cargo test` | Backend unit tests |
| ESLint 10 + typescript-eslint | Linting, including React Hooks rules |
| Clippy | Rust linting |

## Getting started

### Requirements
- Windows 10 or 11
- [Node.js](https://nodejs.org) (LTS)
- [Rust](https://rustup.rs) 1.90 or newer
- Visual Studio Build Tools with the "Desktop development with C++" workload
- WebView2 (already part of Windows 11)

### Setup

```powershell
npm install
# Optional, for Ralp: download the llama.cpp runtime into ai/runtime/
powershell -ExecutionPolicy Bypass -File scripts/fetch-ralp-runtime.ps1
```

### Run and build

```powershell
npm run tauri dev     # development build
npm run tauri build   # release installer
npm run build         # type-check, tests and frontend build
npm run lint
cd src-tauri; cargo test
```

**Administrator rights:** release builds always run as administrator (one UAC
prompt at launch), because most repairs and installs need it. Dev builds don't
ask. To test those features in development, run `npm run tauri dev` from a
terminal opened as administrator.

### First login

On first run, VocaTechX creates the account `administrator` with the password
`password`. You must change the password right after signing in.

## Project layout

```
src/                  React frontend (pages, components, lessons in src/content)
src-tauri/            Rust backend
  src/network/        Network Center
  src/devices/        Printer & Devices
  src/windows_repair/ Windows Repair
  src/software/       Software Center
  src/learning.rs     Learning progress
  src/ralp.rs         AI Troubleshooter
application/          Installers for the Software Center (gitignored)
ai/runtime/           llama.cpp runtime for Ralp (gitignored)
scripts/              Setup scripts
```
