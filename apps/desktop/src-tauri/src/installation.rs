use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Url;

pub const INSTALLATION_FILE_NAME: &str = "installation.json";

const SECURE_SCHEME: &str = "https";
const PLAIN_SCHEME: &str = "http";
const LOCAL_HOSTS: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Installation {
    pub origin: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AddressRejection {
    InvalidUrl,
    InsecureScheme,
}

pub fn installation_from_address(address: &str) -> Result<Installation, AddressRejection> {
    let url = Url::parse(address.trim()).map_err(|_| AddressRejection::InvalidUrl)?;
    let host = url.host_str().ok_or(AddressRejection::InvalidUrl)?;
    let origin = url.origin();
    if !origin.is_tuple() {
        return Err(AddressRejection::InvalidUrl);
    }
    if !reaches_an_installation(url.scheme(), host) {
        return Err(AddressRejection::InsecureScheme);
    }
    Ok(Installation {
        origin: origin.ascii_serialization(),
    })
}

fn reaches_an_installation(scheme: &str, host: &str) -> bool {
    scheme == SECURE_SCHEME || (scheme == PLAIN_SCHEME && LOCAL_HOSTS.contains(&host))
}

pub fn installation_file(config_dir: &Path) -> PathBuf {
    config_dir.join(INSTALLATION_FILE_NAME)
}

pub fn parse_installation(contents: &str) -> Option<Installation> {
    serde_json::from_str::<Installation>(contents)
        .ok()
        .filter(|installation| {
            installation_from_address(&installation.origin)
                .is_ok_and(|checked| checked.origin == installation.origin)
        })
}

pub fn serialize_installation(installation: &Installation) -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(installation)
}

pub fn read_installation(path: &Path) -> Option<Installation> {
    fs::read_to_string(path)
        .ok()
        .as_deref()
        .and_then(parse_installation)
}

pub fn write_installation(path: &Path, installation: &Installation) -> io::Result<()> {
    let contents = serialize_installation(installation)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, contents)
}

pub fn remove_installation(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_the_origin_of_a_secure_address() {
        assert_eq!(
            installation_from_address("https://sylph.example/projects?tab=1"),
            Ok(Installation {
                origin: "https://sylph.example".to_string()
            })
        );
    }

    #[test]
    fn removes_surrounding_whitespace() {
        assert_eq!(
            installation_from_address("  https://sylph.example  "),
            Ok(Installation {
                origin: "https://sylph.example".to_string()
            })
        );
    }

    #[test]
    fn drops_the_default_https_port() {
        assert_eq!(
            installation_from_address("https://sylph.example:443/"),
            Ok(Installation {
                origin: "https://sylph.example".to_string()
            })
        );
    }

    #[test]
    fn drops_the_default_http_port_of_a_local_host() {
        assert_eq!(
            installation_from_address("http://localhost:80/"),
            Ok(Installation {
                origin: "http://localhost".to_string()
            })
        );
    }

    #[test]
    fn drops_credentials_and_the_fragment() {
        assert_eq!(
            installation_from_address("https://user:secret@sylph.example/projects#top"),
            Ok(Installation {
                origin: "https://sylph.example".to_string()
            })
        );
    }

    #[test]
    fn lowercases_the_host() {
        assert_eq!(
            installation_from_address("https://Sylph.EXAMPLE/"),
            Ok(Installation {
                origin: "https://sylph.example".to_string()
            })
        );
    }

    #[test]
    fn keeps_a_custom_port() {
        assert_eq!(
            installation_from_address("https://sylph.example:8443/"),
            Ok(Installation {
                origin: "https://sylph.example:8443".to_string()
            })
        );
    }

    #[test]
    fn allows_plain_http_for_local_hosts() {
        for address in [
            "http://localhost:1420/",
            "http://127.0.0.1:8787/",
            "http://[::1]:8787/",
        ] {
            assert!(installation_from_address(address).is_ok(), "{address}");
        }
    }

    #[test]
    fn keeps_the_port_of_a_local_host() {
        assert_eq!(
            installation_from_address("http://127.0.0.1:8787/projects"),
            Ok(Installation {
                origin: "http://127.0.0.1:8787".to_string()
            })
        );
    }

    #[test]
    fn rejects_plain_http_for_remote_hosts() {
        for address in [
            "http://sylph.example",
            "http://localhost.evil.example",
            "http://192.168.1.10:8787",
        ] {
            assert_eq!(
                installation_from_address(address),
                Err(AddressRejection::InsecureScheme),
                "{address}"
            );
        }
    }

    #[test]
    fn rejects_a_scheme_the_webview_cannot_load_a_document_from() {
        for address in [
            "ws://localhost:8787",
            "wss://sylph.example",
            "ftp://localhost",
            "ftp://files.example/pub",
        ] {
            assert_eq!(
                installation_from_address(address),
                Err(AddressRejection::InsecureScheme),
                "{address}"
            );
        }
    }

    #[test]
    fn rejects_an_empty_address() {
        assert_eq!(
            installation_from_address("   "),
            Err(AddressRejection::InvalidUrl)
        );
    }

    #[test]
    fn rejects_an_address_without_a_scheme() {
        assert_eq!(
            installation_from_address("sylph.example"),
            Err(AddressRejection::InvalidUrl)
        );
    }

    #[test]
    fn rejects_an_address_without_a_host() {
        assert_eq!(
            installation_from_address("https://"),
            Err(AddressRejection::InvalidUrl)
        );
    }

    #[test]
    fn rejects_an_address_without_a_tuple_origin() {
        assert_eq!(
            installation_from_address("sylph://localhost"),
            Err(AddressRejection::InvalidUrl)
        );
    }

    #[test]
    fn reads_back_a_serialized_installation() {
        let installation = Installation {
            origin: "https://sylph.example".to_string(),
        };
        let contents = serialize_installation(&installation).expect("serializes");
        assert_eq!(parse_installation(&contents), Some(installation));
    }

    #[test]
    fn stores_the_origin_under_a_camel_case_key() {
        let contents = serialize_installation(&Installation {
            origin: "https://sylph.example".to_string(),
        })
        .expect("serializes");
        assert!(contents.contains("\"origin\""), "{contents}");
    }

    #[test]
    fn ignores_a_damaged_file() {
        assert_eq!(parse_installation("{"), None);
        assert_eq!(parse_installation("{\"origin\":\"not an address\"}"), None);
    }

    #[test]
    fn ignores_a_saved_origin_the_connect_screen_would_reject() {
        for contents in [
            "{\"origin\":\"http://sylph.example\"}",
            "{\"origin\":\"file:///Applications\"}",
            "{\"origin\":\"https://sylph.example/projects\"}",
            "{\"origin\":\"https://user:secret@sylph.example\"}",
            "{\"origin\":\"https://sylph.example:443\"}",
            "{\"origin\":\"https://Sylph.EXAMPLE\"}",
        ] {
            assert_eq!(parse_installation(contents), None, "{contents}");
        }
    }

    #[test]
    fn keeps_a_saved_origin_the_connect_screen_would_accept() {
        for origin in [
            "https://sylph.example",
            "https://sylph.example:8443",
            "http://localhost:1420",
            "http://127.0.0.1:8787",
        ] {
            assert_eq!(
                parse_installation(&format!("{{\"origin\":\"{origin}\"}}")),
                Some(Installation {
                    origin: origin.to_string()
                }),
                "{origin}"
            );
        }
    }

    #[test]
    fn names_the_file_inside_the_config_directory() {
        assert_eq!(
            installation_file(Path::new("/config/io.github.kcc989.sylph")),
            PathBuf::from("/config/io.github.kcc989.sylph/installation.json")
        );
    }

    #[test]
    fn writes_reads_and_removes_the_saved_installation() {
        let directory = std::env::temp_dir().join(format!(
            "sylph-desktop-test-{}-{}",
            std::process::id(),
            line!()
        ));
        let path = installation_file(&directory);
        let installation = Installation {
            origin: "https://sylph.example".to_string(),
        };
        write_installation(&path, &installation).expect("writes");
        assert_eq!(read_installation(&path), Some(installation));
        remove_installation(&path).expect("removes");
        assert_eq!(read_installation(&path), None);
        remove_installation(&path).expect("removing twice is allowed");
        fs::remove_dir_all(&directory).expect("cleans up");
    }
}
