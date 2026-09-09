use tauri::Url;

const GITHUB_HOST: &str = "github.com";
const GITHUB_HOST_SUFFIX: &str = ".github.com";
const AUTH_PATH_PREFIX: &str = "/api/auth/";
const SECURE_SCHEME: &str = "https";
const PLAIN_SCHEME: &str = "http";
const MAIL_SCHEME: &str = "mailto";
const BLOB_SCHEME: &str = "blob";
const ABOUT_SCHEME: &str = "about";
const ABOUT_PATHS_THE_PARENT_AUTHORS: [&str; 2] = ["blank", "srcdoc"];
const LOCAL_HOSTS: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NavigationDecision {
    Allow,
    AllowInFrame,
    OpenExternally,
    Block,
}

pub fn decide(local_origin: &Url, installation: Option<&Url>, target: &Url) -> NavigationDecision {
    if is_trusted(local_origin, installation, target) {
        NavigationDecision::Allow
    } else if target.scheme() == SECURE_SCHEME {
        NavigationDecision::AllowInFrame
    } else if target.scheme() == PLAIN_SCHEME || target.scheme() == MAIL_SCHEME {
        NavigationDecision::OpenExternally
    } else {
        NavigationDecision::Block
    }
}

pub fn opens_in_default_browser(target: &Url) -> bool {
    is_web_scheme(target) || target.scheme() == MAIL_SCHEME
}

pub fn is_returnable_page(local_origin: &Url, installation: Option<&Url>, target: &Url) -> bool {
    same_origin(local_origin, target)
        || installation.is_some_and(|origin| same_origin(origin, target))
}

pub fn same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

fn is_trusted(local_origin: &Url, installation: Option<&Url>, target: &Url) -> bool {
    same_origin(local_origin, target)
        || installation.is_some_and(|origin| same_origin(origin, target))
        || is_github(target)
        || is_auth_callback(target)
        || is_local_host(target)
        || is_document_the_parent_authors(target)
        || blob_source(target).is_some_and(|source| {
            source.scheme() != BLOB_SCHEME && is_trusted(local_origin, installation, &source)
        })
}

fn is_web_scheme(target: &Url) -> bool {
    target.scheme() == SECURE_SCHEME || target.scheme() == PLAIN_SCHEME
}

fn is_github(target: &Url) -> bool {
    target.scheme() == SECURE_SCHEME
        && target
            .host_str()
            .is_some_and(|host| host == GITHUB_HOST || host.ends_with(GITHUB_HOST_SUFFIX))
}

fn is_auth_callback(target: &Url) -> bool {
    target.scheme() == SECURE_SCHEME && target.path().starts_with(AUTH_PATH_PREFIX)
}

fn is_local_host(target: &Url) -> bool {
    is_web_scheme(target)
        && target
            .host_str()
            .is_some_and(|host| LOCAL_HOSTS.contains(&host))
}

fn is_document_the_parent_authors(target: &Url) -> bool {
    target.scheme() == ABOUT_SCHEME && ABOUT_PATHS_THE_PARENT_AUTHORS.contains(&target.path())
}

fn blob_source(target: &Url) -> Option<Url> {
    if target.scheme() != BLOB_SCHEME {
        return None;
    }
    let (source, _) = target.path().rsplit_once('/')?;
    Url::parse(source).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> Url {
        Url::parse(value).expect("parses")
    }

    fn production_local() -> Url {
        url("tauri://localhost")
    }

    fn decision(installation: Option<&str>, target: &str) -> NavigationDecision {
        let installation = installation.map(url);
        decide(&production_local(), installation.as_ref(), &url(target))
    }

    #[test]
    fn allows_the_local_connect_screen() {
        assert_eq!(
            decision(None, "tauri://localhost/index.html"),
            NavigationDecision::Allow
        );
    }

    #[test]
    fn allows_the_development_connect_screen() {
        assert_eq!(
            decide(
                &url("http://localhost:1420"),
                None,
                &url("http://localhost:1420/")
            ),
            NavigationDecision::Allow
        );
    }

    #[test]
    fn allows_the_connected_installation() {
        for target in [
            "https://sylph.example",
            "https://sylph.example/",
            "https://sylph.example/projects/1/workspaces/2",
            "https://sylph.example/projects?tab=checks#top",
        ] {
            assert_eq!(
                decision(Some("https://sylph.example"), target),
                NavigationDecision::Allow,
                "{target}"
            );
        }
    }

    #[test]
    fn allows_the_installation_on_its_implied_port() {
        assert_eq!(
            decision(Some("https://sylph.example"), "https://sylph.example:443/x"),
            NavigationDecision::Allow
        );
    }

    #[test]
    fn keeps_another_port_of_the_installation_host_out_of_the_main_window() {
        assert_eq!(
            decision(
                Some("https://sylph.example"),
                "https://sylph.example:8443/x"
            ),
            NavigationDecision::AllowInFrame
        );
    }

    #[test]
    fn opens_the_plain_http_installation_host_in_the_browser() {
        assert_eq!(
            decision(Some("https://sylph.example"), "http://sylph.example/x"),
            NavigationDecision::OpenExternally
        );
    }

    #[test]
    fn opens_an_untrusted_plain_http_address_in_the_browser() {
        for target in [
            "http://docs.example.com/guide",
            "http://github.com/login",
            "http://evil.example/api/auth/callback",
        ] {
            assert_eq!(
                decision(Some("https://sylph.example"), target),
                NavigationDecision::OpenExternally,
                "{target}"
            );
        }
    }

    #[test]
    fn keeps_a_subdomain_of_the_installation_out_of_the_main_window() {
        assert_eq!(
            decision(
                Some("https://sylph.example"),
                "https://preview.sylph.example/projects"
            ),
            NavigationDecision::AllowInFrame
        );
    }

    #[test]
    fn allows_github_sign_in() {
        for target in [
            "https://github.com",
            "https://github.com/login/oauth/authorize",
            "https://api.github.com/user",
            "https://gist.github.com/kcc989",
            "https://deep.nested.github.com/x",
        ] {
            assert_eq!(
                decision(None, target),
                NavigationDecision::Allow,
                "{target}"
            );
        }
    }

    #[test]
    fn never_trusts_a_github_lookalike_host() {
        for target in [
            "https://github.com.evil.example/login",
            "https://notgithub.com/login",
            "https://evilgithub.com/login",
            "https://github.company.example/login",
            "https://github.com@evil.example/login",
            "https://user:github.com@evil.example/login",
        ] {
            assert_eq!(
                decision(None, target),
                NavigationDecision::AllowInFrame,
                "{target}"
            );
        }
    }

    #[test]
    fn allows_an_auth_callback_on_another_stage() {
        for target in [
            "https://preview.sylph.example/api/auth/callback/github",
            "https://sylph-pr-42.workers.dev/api/auth/callback/github?code=1",
        ] {
            assert_eq!(
                decision(Some("https://sylph.example"), target),
                NavigationDecision::Allow,
                "{target}"
            );
        }
    }

    #[test]
    fn never_trusts_a_lookalike_auth_path() {
        for target in [
            "https://evil.example/api/auth",
            "https://evil.example/x/api/auth/callback",
            "https://evil.example/?next=/api/auth/callback",
        ] {
            assert_eq!(
                decision(None, target),
                NavigationDecision::AllowInFrame,
                "{target}"
            );
        }
    }

    #[test]
    fn allows_a_local_installation_on_any_port() {
        for target in [
            "http://localhost/projects",
            "http://localhost:3000/projects",
            "http://127.0.0.1:8787/projects",
            "http://[::1]:8787/projects",
            "https://localhost:8443/projects",
        ] {
            assert_eq!(
                decision(None, target),
                NavigationDecision::Allow,
                "{target}"
            );
        }
    }

    #[test]
    fn never_trusts_a_localhost_lookalike_host() {
        for target in [
            "http://localhost.evil.example/projects",
            "http://notlocalhost/projects",
            "http://127.0.0.2:3000/projects",
            "http://localhost@evil.example/projects",
        ] {
            assert_eq!(
                decision(None, target),
                NavigationDecision::OpenExternally,
                "{target}"
            );
        }
    }

    #[test]
    fn allows_the_documents_a_parent_page_authors_for_a_frame() {
        for target in ["about:blank", "about:srcdoc"] {
            assert_eq!(
                decision(Some("https://sylph.example"), target),
                NavigationDecision::Allow,
                "{target}"
            );
        }
    }

    #[test]
    fn allows_an_object_url_that_the_installation_created() {
        for target in [
            "blob:https://sylph.example/9c8f",
            "blob:tauri://localhost/9c8f",
            "blob:https://github.com/9c8f",
        ] {
            assert_eq!(
                decision(Some("https://sylph.example"), target),
                NavigationDecision::Allow,
                "{target}"
            );
        }
    }

    #[test]
    fn refuses_an_object_url_that_another_site_created() {
        for target in [
            "blob:https://evil.example/9c8f",
            "blob:https://sylph.example.evil.test/9c8f",
            "blob:null/9c8f",
            "blob:9c8f",
            "blob:blob:https://sylph.example/1/1",
            "blob:blob:blob:https://sylph.example/1/1/1",
        ] {
            assert_eq!(
                decision(Some("https://sylph.example"), target),
                NavigationDecision::Block,
                "{target}"
            );
        }
    }

    #[test]
    fn refuses_a_document_that_a_page_writes_for_itself() {
        for target in [
            "data:text/html,<p>hello</p>",
            "javascript:location='https://evil.example'",
        ] {
            assert_eq!(
                decision(Some("https://sylph.example"), target),
                NavigationDecision::Block,
                "{target}"
            );
        }
    }

    #[test]
    fn loads_another_site_only_in_a_frame() {
        for target in [
            "https://docs.example.com/guide",
            "https://sylph.example.evil.test/",
        ] {
            assert_eq!(
                decision(Some("https://sylph.example"), target),
                NavigationDecision::AllowInFrame,
                "{target}"
            );
        }
    }

    #[test]
    fn opens_a_mail_address_in_the_mail_client() {
        assert_eq!(
            decision(Some("https://sylph.example"), "mailto:support@example.com"),
            NavigationDecision::OpenExternally
        );
    }

    #[test]
    fn loads_every_site_only_in_a_frame_before_an_installation_is_connected() {
        assert_eq!(
            decision(None, "https://sylph.example/projects"),
            NavigationDecision::AllowInFrame
        );
    }

    #[test]
    fn separates_origins_by_port() {
        assert!(!same_origin(
            &url("http://localhost:1420"),
            &url("http://localhost:3000")
        ));
    }

    #[test]
    fn ignores_the_path_when_comparing_origins() {
        assert!(same_origin(
            &url("https://sylph.example/one"),
            &url("https://sylph.example/two")
        ));
    }

    #[test]
    fn never_hands_a_non_web_scheme_to_the_system_opener() {
        for target in [
            "file:///Applications/Calculator.app",
            "ftp://files.example/pub",
            "sylph-installer://payload",
            "itms-apps://apps.apple.com/app/id1",
        ] {
            assert_eq!(
                decision(Some("https://sylph.example"), target),
                NavigationDecision::Block,
                "{target}"
            );
        }
    }

    #[test]
    fn loads_a_cross_origin_preview_frame() {
        for target in [
            "https://preview.example.workers.dev/",
            "https://challenges.cloudflare.com/turnstile",
        ] {
            assert_eq!(
                decision(Some("https://sylph.example"), target),
                NavigationDecision::AllowInFrame,
                "{target}"
            );
        }
    }

    #[test]
    fn returns_to_a_page_of_an_origin_the_shell_owns() {
        let installation = url("https://sylph.example");
        for target in [
            "tauri://localhost/index.html",
            "https://sylph.example/projects",
            "https://sylph.example:443/projects?tab=checks#top",
        ] {
            assert!(
                is_returnable_page(&production_local(), Some(&installation), &url(target)),
                "{target}"
            );
        }
    }

    #[test]
    fn never_returns_to_a_page_of_another_origin() {
        let installation = url("https://sylph.example");
        for target in [
            "https://evil.example/api/auth/callback/github",
            "https://github.com/login/oauth/authorize",
            "http://localhost:3000/projects",
            "https://preview.sylph.example/projects",
        ] {
            assert!(
                !is_returnable_page(&production_local(), Some(&installation), &url(target)),
                "{target}"
            );
        }
    }

    #[test]
    fn never_returns_to_a_page_that_a_document_created() {
        let installation = url("https://sylph.example");
        for target in [
            "about:blank",
            "about:srcdoc",
            "blob:https://sylph.example/9c8f",
            "data:text/html,<p>hello</p>",
        ] {
            assert!(
                !is_returnable_page(&production_local(), Some(&installation), &url(target)),
                "{target}"
            );
        }
    }

    #[test]
    fn hands_a_new_window_request_to_the_default_browser() {
        for target in [
            "https://docs.example.com/guide",
            "https://github.com/kcc989/sylph",
            "https://sylph.example/projects",
            "http://localhost:3000/projects",
            "mailto:support@example.com",
        ] {
            assert!(opens_in_default_browser(&url(target)), "{target}");
        }
    }

    #[test]
    fn keeps_a_new_window_request_away_from_the_system_opener() {
        for target in [
            "file:///Applications/Calculator.app",
            "ftp://files.example/pub",
            "sylph-installer://payload",
            "itms-apps://apps.apple.com/app/id1",
            "about:blank",
            "about:srcdoc",
        ] {
            assert!(!opens_in_default_browser(&url(target)), "{target}");
        }
    }
}
