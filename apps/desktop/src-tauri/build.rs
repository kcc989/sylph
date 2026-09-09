fn main() {
    let attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "installation_read",
            "installation_connect",
            "installation_disconnect",
        ]));
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
