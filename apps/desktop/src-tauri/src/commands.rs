use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, Url};

use crate::installation::{
    installation_file, installation_from_address, read_installation, remove_installation,
    write_installation, AddressRejection, Installation,
};
use crate::Shell;
use crate::MAIN_WINDOW_LABEL;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DesktopErrorKind {
    InvalidUrl,
    InsecureScheme,
    Storage,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopError {
    pub kind: DesktopErrorKind,
    pub message: String,
}

impl DesktopError {
    pub fn storage(message: String) -> Self {
        Self {
            kind: DesktopErrorKind::Storage,
            message,
        }
    }
}

impl From<AddressRejection> for DesktopError {
    fn from(rejection: AddressRejection) -> Self {
        match rejection {
            AddressRejection::InvalidUrl => Self {
                kind: DesktopErrorKind::InvalidUrl,
                message: "Enter a full Installation address, for example https://sylph.example.workers.dev".to_string(),
            },
            AddressRejection::InsecureScheme => Self {
                kind: DesktopErrorKind::InsecureScheme,
                message: "The Installation address must use HTTPS".to_string(),
            },
        }
    }
}

pub fn installation_path(app: &AppHandle) -> Result<PathBuf, DesktopError> {
    app.path()
        .app_config_dir()
        .map(|directory| installation_file(&directory))
        .map_err(|error| {
            DesktopError::storage(format!("The config directory is unavailable: {error}"))
        })
}

pub fn saved_installation(app: &AppHandle) -> Option<Installation> {
    installation_path(app)
        .ok()
        .as_deref()
        .and_then(read_installation)
}

fn navigate_main_window(app: &AppHandle, url: Url) -> Result<(), DesktopError> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| DesktopError::storage("The main window is not available".to_string()))?
        .navigate(url)
        .map_err(|error| DesktopError::storage(format!("The window did not navigate: {error}")))
}

pub fn connect(app: &AppHandle, address: &str) -> Result<Installation, DesktopError> {
    let installation = installation_from_address(address)?;
    let origin = Url::parse(&installation.origin).map_err(|error| {
        DesktopError::storage(format!("The saved address is unusable: {error}"))
    })?;
    let path = installation_path(app)?;
    write_installation(&path, &installation).map_err(|error| {
        DesktopError::storage(format!("The Installation address was not saved: {error}"))
    })?;
    app.state::<Shell>().set_installation(Some(origin.clone()));
    navigate_main_window(app, origin)?;
    Ok(installation)
}

pub fn disconnect(app: &AppHandle) -> Result<(), DesktopError> {
    let path = installation_path(app)?;
    remove_installation(&path).map_err(|error| {
        DesktopError::storage(format!("The Installation address was not removed: {error}"))
    })?;
    let shell = app.state::<Shell>();
    shell.set_installation(None);
    navigate_main_window(app, shell.local_index())
}

#[tauri::command]
pub fn installation_read(app: AppHandle) -> Option<Installation> {
    saved_installation(&app)
}

#[tauri::command]
pub fn installation_connect(app: AppHandle, address: String) -> Result<Installation, DesktopError> {
    connect(&app, &address)
}

#[tauri::command]
pub fn installation_disconnect(app: AppHandle) -> Result<(), DesktopError> {
    disconnect(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_a_rejected_address_for_the_connect_screen() {
        let error = DesktopError::from(AddressRejection::InsecureScheme);
        let payload = serde_json::to_value(&error).expect("serializes");
        assert_eq!(payload["kind"], "insecureScheme");
        assert_eq!(
            payload["message"],
            "The Installation address must use HTTPS"
        );
    }

    #[test]
    fn serializes_an_invalid_address_kind() {
        let error = DesktopError::from(AddressRejection::InvalidUrl);
        let payload = serde_json::to_value(&error).expect("serializes");
        assert_eq!(payload["kind"], "invalidUrl");
    }

    #[test]
    fn serializes_a_storage_failure_kind() {
        let payload =
            serde_json::to_value(DesktopError::storage("no disk".to_string())).expect("serializes");
        assert_eq!(payload["kind"], "storage");
        assert_eq!(payload["message"], "no disk");
    }

    #[test]
    fn describes_every_failure_the_connect_screen_can_show() {
        for error in [
            DesktopError::from(AddressRejection::InvalidUrl),
            DesktopError::from(AddressRejection::InsecureScheme),
            DesktopError::storage("no disk".to_string()),
        ] {
            assert!(!error.message.is_empty(), "{error:?}");
        }
    }
}
