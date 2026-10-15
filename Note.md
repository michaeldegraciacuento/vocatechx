npm run tauri dev

VocaTechX


I went through the project: the login screen in [App.tsx](src/App.tsx), the Tauri config, the capabilities and the Rust entry point. It's still the starter template plus your login UI. There's no backend logic, database or routing yet. Below is what I found and what I propose. I haven't changed anything.

## Issues in the current project

1. **Release builds would show a blank window.** [tauri.conf.json](src-tauri/tauri.conf.json) sets `frontendDist` to `../build`, but Vite writes to `dist/`. I'd change it to `../dist`.
2. **The app identifier is still `com.tauri.dev`.** The database folder location comes from this identifier, so it should change before any user data exists. I'd use `com.vocatechx.app`; tell me if you want a different one.
3. **There's no content security policy** (`"csp": null`). I'd set a strict one.
4. **The Sign in button arrow shows as a garbled character** at [App.tsx:153](src/App.tsx#L153). `ArrowRight` is already imported but unused, so I'd use it there.
5. **The window opens at 800×600**, which is too small for a sidebar dashboard. I'd use 1280×800 with a 1024×680 minimum.

## Architecture

**Backend (Rust)** does everything that matters for security:
- **Database:** SQLite through `rusqlite`. The file is `vocatechx.db` in the app data folder (`%APPDATA%\com.vocatechx.app\`). Database versions are tracked with SQLite's built-in `user_version`, and every query is parameterized.
- **Admin account:** on first run, `administrator` / `password` is created with `must_change_password = 1`.
- **Password hashing:** Argon2id, with a random salt per password and the hash stored in PHC string format. Hashes never leave Rust.
- **Session:** held only in the backend's memory. The frontend never gets a token, so there's nothing for it to store or leak.
  - Every protected command checks the session first.
  - While a password change is required, only the change-password and logout commands work.
  - Closing the app ends the session, so a restart means logging in again.
- **Login throttling:** 5 failed attempts lock the account for 5 minutes.
  - The counter and lock time are stored in SQLite, so restarting the app doesn't reset them.
  - Unknown usernames are counted in memory and still go through a dummy hash check. That way the response looks the same and doesn't reveal whether a username exists.
- **Responsiveness:** commands are `async` and run password hashing on a background thread, so the window doesn't freeze while it runs.
- **Permissions:** an allow-list built into the app (Tauri's app manifest) declares exactly which VocaTechX commands exist, and the main window's capability grants only those. No shell, file system or other plugins are added, and nothing can run arbitrary commands.

**Frontend (React)**
- An auth context asks the backend for the session state and shows one of three screens: Login, Change Password or the Dashboard area.
- Page switching uses component state, not a router library. That's enough for a desktop app and stops anyone reaching a protected page by URL.

**Database tables**

| Table | Contents |
|---|---|
| `users` | id, username (unique), password_hash, role (`admin`/`technician`), must_change_password, failed_attempts, locked_until, created_at, updated_at |
| `app_settings` | key (primary key), value, updated_at |
| `operation_runs` | id, operation_type, title, status (`running`/`success`/`failed`/`cancelled`), summary, started_at, finished_at, user_id |
| `operation_logs` | id, run_id (deleted along with its run), level, message, created_at |

**Real data vs. placeholders**
- **Real data:** CPU and memory use, storage, OS name and version, hostname. These come from the `sysinfo` crate and refresh every few seconds.
- **Recent Activity:** reads from `operation_runs`. No operations exist yet, so it shows an empty state.
- **"Offline" status:** reported truthfully as "Runs locally — no network required". The app doesn't check internet connectivity, because it doesn't need it.
- **Local AI model:** nothing in the project integrates one yet, so it shows "Not configured" until we connect a real check (see question 1).

## Files

**Files to change**
- [src-tauri/Cargo.toml](src-tauri/Cargo.toml): add dependencies. Also compile `argon2` optimized in debug builds, because otherwise each login takes several seconds while you're developing.
- [src-tauri/build.rs](src-tauri/build.rs): the command allow-list.
- [src-tauri/src/lib.rs](src-tauri/src/lib.rs): open the database, set up shared state, register the commands.
- [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json): fixes 1, 2, 3 and 5.
- [src-tauri/capabilities/default.json](src-tauri/capabilities/default.json): grant only the VocaTechX commands.
- [src/App.tsx](src/App.tsx): becomes the auth gate.
- [src/main.tsx](src/main.tsx): wrap the app in the auth provider.

**New backend files** (`src-tauri/src/`)
- `error.rs`: one error type with messages that are safe to show the user.
- `db.rs`: connecting, migrations, creating the admin account.
- `auth.rs`: hashing, checking passwords, throttling, password rules, plus unit tests.
- `session.rs`: in-memory session state.
- `system_info.rs`: reads system data through `sysinfo`.
- `commands/{mod,auth,dashboard}.rs`:
  - auth: `login`, `logout`, `get_session`, `change_password`
  - dashboard: `get_system_overview`, `get_recent_activity`, `get_system_status`
- `permissions/vocatechx.toml`: the permission set the capability grants.

**New frontend files** (`src/`)
- `lib/api.ts`: typed wrappers around `invoke`.
- `auth/AuthContext.tsx`
- `pages/LoginPage.tsx`: your current login markup moved here unchanged. The only additions are an error message line under the form and a loading or disabled state on the Sign in button.
- `pages/ChangePasswordPage.tsx`: same visual style as the login screen.
- `pages/DashboardPage.tsx`
- `pages/PlaceholderPage.tsx`: one reusable "coming soon" page for the 7 modules that aren't built yet.
- `layout/AppLayout.tsx`
- `components/Sidebar.tsx`, `Header.tsx`, `SummaryCard.tsx`, `QuickActions.tsx`, `ActivityList.tsx`, `SystemStatusPanel.tsx`
- `navigation.ts`: the shared list of pages, their icons and titles.

## Dependencies to install

**Rust** (all work offline once downloaded):
- `rusqlite` with the `bundled` feature, so SQLite is compiled in and no DLL is needed
- `argon2`
- `rand`
- `sysinfo`
- `thiserror`
- `chrono`

**npm:** nothing new. React, Tailwind, Lucide and `@tauri-apps/api` already cover it.

## Testing

**Automated (`cargo test`)**, using a temporary database:
- First-run setup creates the admin account.
- Login works with the right password and fails with the wrong one.
- First-login password change: the password rules apply, the new password must differ from the old one, and the flag is cleared.
- The account locks after 5 failures and unlocks once the lock time passes.
- The lock is still there when the database is reopened, which simulates a restart.
- Protected commands are refused without a session.
- Logout ends the session.

**Manual checklist** for things only the real app shows: the screen flow, the logout flow, restarting the app, and running with the network disconnected.

## Before I start

1. **Local AI model:** what will VocaTechX use, for example Ollama or a GGUF model file in a known folder? If it's not decided, I'll show "Not configured" for now.
2. **Fixes:** are the identifier change (`com.vocatechx.app`) and window size change OK?
3. **Password rules:** is at least 8 characters, including at least one letter and one number, OK?

If you approve, I'll build it in this order and check each stage before moving on:
1. Backend: database, auth and tests, checked with `cargo test`.
2. Commands and permissions, checked with `cargo build`.
3. Login and password-change flow.
4. Dashboard and placeholder pages, checked with `npm run build` and a launch of `tauri dev`.