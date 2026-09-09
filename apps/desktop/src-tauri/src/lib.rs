pub mod commands;
pub mod installation;
pub mod menu;
pub mod navigation;

use std::error::Error;
use std::fmt;
use std::sync::{Mutex, PoisonError};

use tauri::menu::MenuEvent;
use tauri::utils::config::{Config, FrontendDist, WindowConfig};
use tauri::webview::{NewWindowFeatures, NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, Runtime, Url, WebviewWindowBuilder, Wry};
use tauri_plugin_opener::OpenerExt;

use crate::menu::MenuAction;
use crate::navigation::NavigationDecision;

pub const MAIN_WINDOW_LABEL: &str = "main";

const EMBEDDED_ASSET_ORIGIN: &str = "tauri://localhost";
const EMBEDDED_ASSET_ORIGIN_WINDOWS: &str = "http://tauri.localhost";

pub struct Shell {
    local_index: Url,
    installation: Mutex<Option<Url>>,
    trusted_page: Mutex<Url>,
    recovering: Mutex<Option<Url>>,
}

impl Shell {
    pub fn new(local_index: Url, installation: Option<Url>) -> Self {
        let trusted_page = installation.clone().unwrap_or_else(|| local_index.clone());
        Self {
            local_index,
            installation: Mutex::new(installation),
            trusted_page: Mutex::new(trusted_page),
            recovering: Mutex::new(None),
        }
    }

    pub fn local_index(&self) -> Url {
        self.local_index.clone()
    }

    pub fn installation(&self) -> Option<Url> {
        self.installation
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    pub fn set_installation(&self, origin: Option<Url>) {
        self.remember_trusted_page(origin.clone().unwrap_or_else(|| self.local_index()));
        self.set_recovery_attempt(None);
        *self
            .installation
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = origin;
    }

    pub fn trusted_page(&self) -> Url {
        self.trusted_page
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    pub fn remember_trusted_page(&self, page: Url) {
        *self
            .trusted_page
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = page;
    }

    pub fn recovery_attempt(&self) -> Option<Url> {
        self.recovering
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    pub fn set_recovery_attempt(&self, attempt: Option<Url>) {
        *self
            .recovering
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = attempt;
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Recovery {
    pub target: Url,
    pub attempt: Option<Url>,
}

pub fn plan_recovery(local_index: &Url, trusted_page: &Url, attempted: Option<&Url>) -> Recovery {
    if attempted.is_some_and(|attempt| attempt == trusted_page) {
        Recovery {
            target: local_index.clone(),
            attempt: None,
        }
    } else {
        Recovery {
            target: trusted_page.clone(),
            attempt: Some(trusted_page.clone()),
        }
    }
}

#[derive(Debug)]
pub struct MissingMainWindow;

impl fmt::Display for MissingMainWindow {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "the {MAIN_WINDOW_LABEL} window is not configured"
        )
    }
}

impl Error for MissingMainWindow {}

pub fn embedded_asset_origin() -> Url {
    let origin = if cfg!(windows) {
        EMBEDDED_ASSET_ORIGIN_WINDOWS
    } else {
        EMBEDDED_ASSET_ORIGIN
    };
    Url::parse(origin).expect("the embedded asset origin is a valid address")
}

pub fn local_index_url(configured_app_url: Option<&Url>) -> Url {
    configured_app_url
        .cloned()
        .unwrap_or_else(embedded_asset_origin)
}

fn configured_app_url(config: &Config) -> Option<&Url> {
    if tauri::is_dev() {
        config.build.dev_url.as_ref()
    } else {
        match config.build.frontend_dist.as_ref() {
            Some(FrontendDist::Url(url)) => Some(url),
            _ => None,
        }
    }
}

fn main_window_config(config: &Config) -> Result<WindowConfig, MissingMainWindow> {
    config
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW_LABEL)
        .cloned()
        .ok_or(MissingMainWindow)
}

fn open_externally<R: Runtime>(app: &AppHandle<R>, target: &Url) {
    let _ = app.opener().open_url(target.as_str(), None::<&str>);
}

fn load_in_main_window<R: Runtime>(app: &AppHandle<R>, target: Url) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.navigate(target);
    }
}

fn allows_navigation<R: Runtime>(app: &AppHandle<R>, target: &Url) -> bool {
    let shell = app.state::<Shell>();
    match navigation::decide(&shell.local_index(), shell.installation().as_ref(), target) {
        NavigationDecision::Allow | NavigationDecision::AllowInFrame => true,
        NavigationDecision::OpenExternally => {
            open_externally(app, target);
            false
        }
        NavigationDecision::Block => false,
    }
}

fn route_new_window<R: Runtime>(app: &AppHandle<R>, target: &Url) -> NewWindowResponse<R> {
    if navigation::opens_in_default_browser(target) {
        open_externally(app, target);
    }
    NewWindowResponse::Deny
}

fn remember_main_document(shell: &Shell, target: &Url) {
    if navigation::is_returnable_page(&shell.local_index(), shell.installation().as_ref(), target) {
        shell.remember_trusted_page(target.clone());
    }
}

fn recover_main_window<R: Runtime>(app: &AppHandle<R>, shell: &Shell) {
    let recovery = plan_recovery(
        &shell.local_index(),
        &shell.trusted_page(),
        shell.recovery_attempt().as_ref(),
    );
    shell.set_recovery_attempt(recovery.attempt);
    load_in_main_window(app, recovery.target);
}

fn guard_main_document<R: Runtime>(app: &AppHandle<R>, target: &Url) {
    let shell = app.state::<Shell>();
    match navigation::decide(&shell.local_index(), shell.installation().as_ref(), target) {
        NavigationDecision::Allow => {
            shell.set_recovery_attempt(None);
            remember_main_document(&shell, target);
        }
        NavigationDecision::AllowInFrame | NavigationDecision::OpenExternally => {
            open_externally(app, target);
            recover_main_window(app, &shell);
        }
        NavigationDecision::Block => recover_main_window(app, &shell),
    }
}

fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let Some(action) = menu::menu_action(event.id().as_ref()) else {
        return;
    };
    match action {
        MenuAction::SwitchInstallation => {
            let _ = commands::disconnect(app);
        }
        MenuAction::Reload => {
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = window.reload();
            }
        }
        MenuAction::OpenDocumentation => {
            let _ = app.opener().open_url(menu::DOCUMENTATION_URL, None::<&str>);
        }
    }
}

pub fn run() {
    tauri::Builder::<Wry>::default()
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .menu(menu::build)
        .on_menu_event(handle_menu_event)
        .setup(|app| {
            let local_index = local_index_url(configured_app_url(app.config()));
            let installation = commands::saved_installation(app.handle())
                .and_then(|installation| Url::parse(&installation.origin).ok());
            app.manage(Shell::new(local_index, installation.clone()));

            let window_config = main_window_config(app.config())?;
            let navigating = app.handle().clone();
            let opening = app.handle().clone();
            let guarding = app.handle().clone();
            let window = WebviewWindowBuilder::from_config(app.handle(), &window_config)?
                .on_navigation(move |target| allows_navigation(&navigating, target))
                .on_new_window(move |target, _features: NewWindowFeatures| {
                    route_new_window(&opening, &target)
                })
                .on_page_load(move |_window, payload| match payload.event() {
                    PageLoadEvent::Started => guard_main_document(&guarding, payload.url()),
                    PageLoadEvent::Finished => {}
                })
                .build()?;

            if let Some(origin) = installation {
                window.navigate(origin)?;
            }
            window.show()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::installation_read,
            commands::installation_connect,
            commands::installation_disconnect
        ])
        .run(tauri::generate_context!())
        .expect("the Sylph desktop app failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_the_configured_address_of_the_connect_screen() {
        let development = Url::parse("http://localhost:1420").expect("parses");
        assert_eq!(local_index_url(Some(&development)), development);
    }

    #[test]
    fn falls_back_to_the_embedded_asset_origin() {
        assert_eq!(local_index_url(None), embedded_asset_origin());
    }

    #[test]
    fn serves_the_embedded_connect_screen_from_one_origin() {
        let origin = embedded_asset_origin();
        assert!(navigation::same_origin(&origin, &origin));
        assert!(navigation::is_returnable_page(&origin, None, &origin));
        assert_eq!(
            navigation::decide(&origin, None, &origin),
            NavigationDecision::Allow
        );
    }

    #[test]
    fn keeps_the_installation_the_shell_was_started_with() {
        let local_index = Url::parse("tauri://localhost").expect("parses");
        let installation = Url::parse("https://sylph.example").expect("parses");
        let shell = Shell::new(local_index.clone(), Some(installation.clone()));
        assert_eq!(shell.local_index(), local_index);
        assert_eq!(shell.installation(), Some(installation));
    }

    #[test]
    fn forgets_the_installation_when_the_user_switches() {
        let shell = Shell::new(Url::parse("tauri://localhost").expect("parses"), None);
        let installation = Url::parse("https://sylph.example").expect("parses");
        shell.set_installation(Some(installation.clone()));
        assert_eq!(shell.installation(), Some(installation));
        shell.set_installation(None);
        assert_eq!(shell.installation(), None);
    }

    #[test]
    fn starts_the_trusted_page_at_the_connect_screen() {
        let local_index = Url::parse("tauri://localhost").expect("parses");
        let shell = Shell::new(local_index.clone(), None);
        assert_eq!(shell.trusted_page(), local_index);
    }

    #[test]
    fn starts_the_trusted_page_at_the_saved_installation() {
        let installation = Url::parse("https://sylph.example").expect("parses");
        let shell = Shell::new(
            Url::parse("tauri://localhost").expect("parses"),
            Some(installation.clone()),
        );
        assert_eq!(shell.trusted_page(), installation);
    }

    #[test]
    fn keeps_the_page_an_external_link_was_clicked_on() {
        let installation = Url::parse("https://sylph.example").expect("parses");
        let shell = Shell::new(
            Url::parse("tauri://localhost").expect("parses"),
            Some(installation),
        );
        let workspace =
            Url::parse("https://sylph.example/projects/1/workspaces/2").expect("parses");
        shell.remember_trusted_page(workspace.clone());
        assert_eq!(shell.trusted_page(), workspace);
    }

    #[test]
    fn follows_the_installation_through_its_own_pages() {
        let shell = Shell::new(
            Url::parse("tauri://localhost").expect("parses"),
            Some(Url::parse("https://sylph.example").expect("parses")),
        );
        let workspace =
            Url::parse("https://sylph.example/projects/1/workspaces/2").expect("parses");
        remember_main_document(&shell, &workspace);
        assert_eq!(shell.trusted_page(), workspace);
    }

    #[test]
    fn stays_on_the_installation_through_the_github_sign_in_hop() {
        let installation = Url::parse("https://sylph.example").expect("parses");
        let shell = Shell::new(
            Url::parse("tauri://localhost").expect("parses"),
            Some(installation.clone()),
        );
        for target in [
            "https://github.com/login/oauth/authorize",
            "https://preview.sylph.example/api/auth/callback/github",
        ] {
            remember_main_document(&shell, &Url::parse(target).expect("parses"));
            assert_eq!(shell.trusted_page(), installation, "{target}");
        }
    }

    #[test]
    fn never_pins_the_trusted_page_to_another_host() {
        let installation = Url::parse("https://sylph.example").expect("parses");
        let shell = Shell::new(
            Url::parse("tauri://localhost").expect("parses"),
            Some(installation.clone()),
        );
        for target in [
            "https://evil.example/api/auth/callback/github",
            "http://localhost:3000/projects",
            "https://sylph.example:8443/projects",
        ] {
            remember_main_document(&shell, &Url::parse(target).expect("parses"));
            assert_eq!(shell.trusted_page(), installation, "{target}");
        }
    }

    #[test]
    fn returns_an_untrusted_document_to_the_trusted_page() {
        let local_index = Url::parse("tauri://localhost").expect("parses");
        let installation = Url::parse("https://sylph.example").expect("parses");
        let recovery = plan_recovery(&local_index, &installation, None);
        assert_eq!(recovery.target, installation);
        assert_eq!(recovery.attempt, Some(installation));
    }

    #[test]
    fn falls_back_to_the_connect_screen_when_the_trusted_page_redirects_away() {
        let local_index = Url::parse("tauri://localhost").expect("parses");
        let installation = Url::parse("https://sylph.example").expect("parses");
        let first = plan_recovery(&local_index, &installation, None);
        let second = plan_recovery(&local_index, &installation, first.attempt.as_ref());
        assert_eq!(second.target, local_index);
        assert_eq!(second.attempt, None);
    }

    #[test]
    fn re_arms_the_guard_when_the_user_connects_to_another_installation() {
        let local_index = Url::parse("tauri://localhost").expect("parses");
        let first = Url::parse("https://sylph.example").expect("parses");
        let shell = Shell::new(local_index.clone(), Some(first.clone()));
        shell.set_recovery_attempt(Some(first));
        let second = Url::parse("https://other.example").expect("parses");
        shell.set_installation(Some(second.clone()));
        assert_eq!(shell.recovery_attempt(), None);
        assert_eq!(
            plan_recovery(&local_index, &shell.trusted_page(), None).target,
            second
        );
    }

    #[test]
    fn returns_to_the_connect_screen_after_the_user_switches() {
        let local_index = Url::parse("tauri://localhost").expect("parses");
        let shell = Shell::new(
            local_index.clone(),
            Some(Url::parse("https://sylph.example/projects").expect("parses")),
        );
        shell.set_installation(None);
        assert_eq!(shell.trusted_page(), local_index);
    }
}
