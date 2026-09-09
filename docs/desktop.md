# Desktop app

The Sylph desktop app is a native macOS shell for one remote Installation. It does not run Sylph on your machine. It loads a deployed Installation in a WKWebView window and adds a connect screen, a macOS menu, and a navigation policy. The source lives in `apps/desktop`.

The app does not re-implement product UI. Every product screen comes from the Installation you connect to.

## Requirements

- macOS 12 or later.
- Xcode Command Line Tools. Install them with `xcode-select --install`.
- A stable Rust toolchain. Install it with [rustup](https://rustup.rs).
- Bun. The root `package.json` pins the supported version.

## Run the app in development

Install the workspace first:

```sh
bun install --frozen-lockfile
```

Then start the app from the repository root:

```sh
bun run desktop:dev
```

This command runs `tauri dev` in `apps/desktop`. Tauri starts Vite on `http://localhost:1420` and compiles the Rust binary in debug mode. The first compile takes several minutes. Later compiles reuse the Cargo cache in `apps/desktop/src-tauri/target`.

The root `bun run build` task runs `vite build` for `apps/desktop`. It never calls Cargo. This keeps Linux CI green.

## Build a release bundle

Run the bundler from the repository root on macOS:

```sh
bun run desktop:build
```

This command runs `tauri build`. It writes two bundles:

- `apps/desktop/src-tauri/target/release/bundle/macos/Sylph.app`
- `apps/desktop/src-tauri/target/release/bundle/dmg/Sylph_0.1.0_aarch64.dmg`

The disk image name combines the product name, the version in `tauri.conf.json`, and the build architecture.

## Connect to an Installation

The first launch shows the connect screen. Enter the address of your Installation and select **Connect**.

The app validates the address with the same rule as the web app in `apps/web/src/server/installation-address.ts`. The address must use `https:`. The app accepts `http:` only when the host is `localhost`, `127.0.0.1`, or `[::1]`. The app keeps the normalized origin and drops the path, the query, and the fragment.

The app writes the origin to `~/Library/Application Support/io.github.kcc989.sylph/installation.json`:

```json
{
  "origin": "https://sylph.example"
}
```

The app then navigates the main window to that origin.

Later launches read the file during startup. The app navigates to the saved origin before it shows the window, so no connect screen appears.

A rejected address leaves the connect screen in place. The app shows the message from the Rust command and keeps the text you entered.

## The IPC boundary

Only the local connect screen can call Tauri commands. Pages served by the Installation get no IPC access.

Three commands make up the whole contract:

- `installation_read` returns the saved Installation or nothing.
- `installation_connect` takes an address, validates it, saves the origin, and navigates the main window to it.
- `installation_disconnect` deletes the saved file and returns the main window to the connect screen.

A rejected command returns `{ "kind": "invalidUrl" | "insecureScheme" | "storage", "message": string }`. The connect screen renders `message` and nothing else.

Three settings hold this boundary:

- `apps/desktop/src-tauri/capabilities/default.json` grants the three commands to the `main` window only. It declares no `remote` field, so a remote origin receives no permission. It grants no opener permission, so no page can ask the app to open an address. The Rust opener call skips the capability scope, so the shell checks the scheme itself.
- `app.withGlobalTauri` is `false` in `tauri.conf.json`, so Tauri injects no global API object.
- `app.security.csp` restricts the local connect screen to its own assets and to the IPC endpoint.

## Navigation policy

`apps/desktop/src-tauri/src/navigation.rs` holds the policy. Its functions are pure and unit tested.

### What the webview loads

WKWebView reports a frame navigation and a top-level navigation through the same callback. Tauri 2.11 passes no frame information to `on_navigation`. The app therefore cannot tell the two apart before the load starts. It lets every web address through this callback and enforces the main-window rule after the document commits.

`navigation::decide` sorts every requested address into one of four decisions:

- **Allow**: the address is trusted. It loads in the main window and in a frame.
- **Allow in a frame**: the address uses `https:` and is not trusted. It loads, because the request may be a frame. The main-window rule below moves the address out of the window when the load turns out to be a top-level load.
- **Open externally**: the address uses `mailto:`, or the address uses `http:` and is not trusted. The app cancels the navigation and hands the address to your mail client or to your default browser. App Transport Security blocks a non-local `http:` load in WKWebView, so such an address never commits and the main-window rule below never sees it.
- **Block**: the address uses any other scheme. The app cancels the navigation and opens nothing. A `data:`, `javascript:`, `file:`, or custom scheme address therefore never loads and never reaches the system. A `blob:` address from an untrusted source is blocked in the same way.

A frame from any `https:` origin loads. The Workspace browser panel and its Application iframe therefore work inside the app. A GitHub sign-in page that embeds a third-party frame also works.

An address is trusted when it is:

- the local connect screen origin;
- the connected Installation origin, matched on scheme, host, and port;
- `https://github.com` or any subdomain of `github.com`, for GitHub sign-in;
- any `https:` address whose path starts with `/api/auth/`, for Better Auth OAuth Proxy callbacks on another Sylph stage (see [OAuth across preview stages](maintainers.md#oauth-across-preview-stages));
- `http:` or `https:` on `localhost`, `127.0.0.1`, or `[::1]`;
- `about:blank` or `about:srcdoc`, the documents that a parent page authors for a frame;
- a `blob:` address whose source origin is trusted. The app reads the source origin from the `blob:` path and classifies it with the same rule. The app resolves one level only, so a `blob:` address that names another `blob:` address as its source is never trusted.

A `data:` address and a `javascript:` address are never trusted. A page therefore cannot make itself trusted with `URL.createObjectURL` or with a written document.

### What the main window keeps

WKWebView commits a main frame document through a second callback. Tauri 2.11 reports that commit as `PageLoadEvent::Started`, and WKWebView raises it for the main frame only. This callback carries the main-window rule. The app classifies the committed address a second time and then acts:

- It keeps a trusted address in the window. It records the address as the last trusted page only when the address belongs to the local connect screen origin or to the connected Installation origin. A `github.com` page, a cross-stage `/api/auth/` callback, a local host page, and an `about:blank` document therefore stay in the window without becoming the page the app returns to.
- It opens an untrusted `http:` or `https:` address, and every `mailto:` address, in your default browser, and it returns the main window to the last trusted page.
- It returns the main window to the last trusted page, and opens nothing, for every other untrusted address.

The return to the last trusted page runs once per attempt. The app records the address it returns to. If the next committed document is untrusted again and the last trusted page has not changed, the app returns the window to the local connect screen instead. An Installation origin that redirects to another origin therefore ends on the connect screen and not in a loop of reloads. A trusted commit clears the record, so the next untrusted document gets a full return again.

A move of the main window to an untrusted origin therefore ends in your default browser. The window goes back to the last trusted page. The untrusted document loads for the moment between the commit and the return, so it can run a script. It gets no IPC access, because the capability names the local connect screen alone.

The last trusted page starts at the connected Installation origin. It starts at the local connect screen when no Installation is connected. The app records only an address of an origin that the shell owns, so the trusted page stays on the Installation across a GitHub sign-in hop. A third-party page, an `about:blank` document, an `about:srcdoc` document, and a `blob:` document never become the page the app returns to.

### Where a new window goes

The app denies every new-window request. A `target="_blank"` link and a `window.open` call never open a second window. They also never change the main window. The app opens the requested address in your default browser when the address uses `http:`, `https:`, or `mailto:`. The app does nothing for every other scheme. A sandboxed frame therefore cannot replace the app document with an address that the frame chooses.

The shell hands an address to the macOS opener from the navigation callback, the page-load guard, the new-window handler, and the Help item. It hands over only `http:`, `https:`, and `mailto:` addresses, plus the fixed documentation address. The Rust opener call skips the capability scope, so this scheme check is the boundary.

The app also turns off the click script of the opener plugin with `open_js_links_on_click(false)`. Tauri injects that script into every page, including Installation pages. On an Installation page the script cancels the click and then calls IPC, which the capability denies, so the click would do nothing.

## Session persistence

The main window uses the default persistent WKWebView data store. macOS keeps the Better Auth session cookie for the Installation origin after you quit the app. You stay signed in on the next launch.

## Switch Installations

Select **Switch Installation…** in the **Sylph** menu, or press `Cmd+Shift+I`.

The app deletes `installation.json`, forgets the origin, and returns the main window to the connect screen. Connect to another Installation from there.

The app does not clear the cookie store. The session cookie of the previous Installation stays on disk. Sign out inside that Installation first if you want to remove it.

## Menu bar

- **Sylph**: About Sylph, Switch Installation…, Services, Hide, Hide Others, Show All, Quit.
- **Edit**: Undo, Redo, Cut, Copy, Paste, Select All. WKWebView needs these items for the matching keyboard shortcuts.
- **View**: Reload (`Cmd+R`), Toggle Full Screen.
- **Window**: Minimize, Zoom, Close Window.
- **Help**: Sylph Documentation. This item opens the repository README in your default browser.

The app registers the Window and Help submenus under the standard Tauri identifiers. macOS then adopts them as the system Window and Help menus and adds its own entries, such as the window list and the Help search field.

## Signing and notarization

`bun run desktop:build` produces an unsigned bundle. macOS Gatekeeper blocks an unsigned app that you download from the internet. Allow the app in System Settings under Privacy and Security, or sign the build yourself.

Sylph does not automate signing. `tauri build` reads these environment variables when they are present:

- `APPLE_SIGNING_IDENTITY`: the Developer ID Application identity in your keychain.
- `APPLE_ID`: the Apple ID that owns the notarization submission.
- `APPLE_PASSWORD`: an app-specific password for that Apple ID.
- `APPLE_TEAM_ID`: the Apple Developer team identifier.

Set all four before you run the build. Store them as encrypted secrets if you add signing to a workflow. Do not commit them.

## Download a build from CI

The **Desktop** workflow in `.github/workflows/desktop.yml` builds the app on a macOS runner. It runs on a push that touches `apps/desktop`, the shared UI package, the lockfile, or the lint and format configuration. It also runs on manual dispatch.

Open the workflow run in GitHub Actions. Download the `sylph-macos` artifact from the run summary. The artifact holds the disk image and `Sylph.app.zip`. Both are unsigned, so Gatekeeper needs an override on first launch.

## Known limits

- A magic-link email opens in your default browser. The app registers no URL scheme, so a magic link signs you in in the browser and not in the app. Use GitHub sign-in inside the app.
- A frame from any `https:` origin loads. Tauri 2.11 gives the navigation policy no frame information, so the app cannot hold a frame to the trusted set without blocking the Workspace browser panel.
- An untrusted `http:` frame does not load. The app sends the address to your default browser, because App Transport Security blocks the load in the window anyway.
- An untrusted main-window document starts to load before the app moves it out. The app opens the address in your default browser and returns the window to the last trusted page after the document commits, so the document runs for a moment inside the window.
- The app connects to one Installation at a time.
- The app has no auto-update. Download a new build to upgrade.
- The app targets macOS only. It has no Windows or Linux bundle.
