use tauri::menu::{
    Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Runtime};

pub const SWITCH_INSTALLATION_ITEM_ID: &str = "switch-installation";
pub const RELOAD_ITEM_ID: &str = "reload";
pub const DOCUMENTATION_ITEM_ID: &str = "documentation";
pub const DOCUMENTATION_URL: &str = "https://github.com/kcc989/sylph#readme";

const SWITCH_INSTALLATION_LABEL: &str = "Switch Installation…";
const SWITCH_INSTALLATION_ACCELERATOR: &str = "CmdOrCtrl+Shift+I";
const RELOAD_LABEL: &str = "Reload";
const RELOAD_ACCELERATOR: &str = "CmdOrCtrl+R";
const DOCUMENTATION_LABEL: &str = "Sylph Documentation";
const ABOUT_LABEL: &str = "About Sylph";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MenuAction {
    SwitchInstallation,
    Reload,
    OpenDocumentation,
}

pub fn menu_action(item_id: &str) -> Option<MenuAction> {
    match item_id {
        SWITCH_INSTALLATION_ITEM_ID => Some(MenuAction::SwitchInstallation),
        RELOAD_ITEM_ID => Some(MenuAction::Reload),
        DOCUMENTATION_ITEM_ID => Some(MenuAction::OpenDocumentation),
        _ => None,
    }
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let application = Submenu::with_items(
        app,
        app.package_info().name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, Some(ABOUT_LABEL), None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                SWITCH_INSTALLATION_ITEM_ID,
                SWITCH_INSTALLATION_LABEL,
                true,
                Some(SWITCH_INSTALLATION_ACCELERATOR),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(
                app,
                RELOAD_ITEM_ID,
                RELOAD_LABEL,
                true,
                Some(RELOAD_ACCELERATOR),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let window = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let help = Submenu::with_id_and_items(
        app,
        HELP_SUBMENU_ID,
        "Help",
        true,
        &[&MenuItem::with_id(
            app,
            DOCUMENTATION_ITEM_ID,
            DOCUMENTATION_LABEL,
            true,
            None::<&str>,
        )?],
    )?;

    Menu::with_items(app, &[&application, &edit, &view, &window, &help])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_every_item_the_app_handles_itself() {
        assert_eq!(
            menu_action(SWITCH_INSTALLATION_ITEM_ID),
            Some(MenuAction::SwitchInstallation)
        );
        assert_eq!(menu_action(RELOAD_ITEM_ID), Some(MenuAction::Reload));
        assert_eq!(
            menu_action(DOCUMENTATION_ITEM_ID),
            Some(MenuAction::OpenDocumentation)
        );
    }

    #[test]
    fn leaves_predefined_items_to_the_operating_system() {
        for item_id in [
            "quit",
            "copy",
            "fullscreen",
            "",
            "switch-installation ",
            WINDOW_SUBMENU_ID,
            HELP_SUBMENU_ID,
        ] {
            assert_eq!(menu_action(item_id), None, "{item_id}");
        }
    }

    #[test]
    fn points_the_help_link_at_a_page_the_browser_can_open() {
        let documentation = tauri::Url::parse(DOCUMENTATION_URL).expect("parses");
        assert_eq!(documentation.scheme(), "https");
        assert_eq!(documentation.host_str(), Some("github.com"));
    }
}
