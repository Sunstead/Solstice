//! Configuration from `SOLSTICE_*` environment variables. Secrets also read
//! from `<NAME>_FILE`. Mirrors Atlas's `config.rs`.

use std::net::SocketAddr;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Config {
    /// `SOLSTICE_BIND`, default `0.0.0.0:8080`.
    pub bind: SocketAddr,
    /// `SOLSTICE_NOTES_DIR`: vault files, one folder per user then per vault
    /// (`<dir>/<username>/<vault>/`). Default `.data/notes`; the image sets
    /// `/notes` (Jupiter's `data/notes`, backed up as originals).
    pub notes_dir: PathBuf,
    /// `SOLSTICE_STATE_DIR`: `sync.db` (users, tokens, vaults, Yjs state).
    /// Default `.data/state`; the image sets `/state` (a backed-up volume).
    pub state_dir: PathBuf,
    pub auth: AuthMode,
    /// `SOLSTICE_PUBLIC_URL`, e.g. `https://solstice.jupiter.sunstead.net`:
    /// where browsers reach the server. Web sign-in needs it (the redirect
    /// URI, the cookie, the origin check); without it only apps sign in.
    pub public_url: Option<url::Url>,
    /// `SOLSTICE_WEB_DIR`: the built web app, served at `/`. The image sets
    /// it; unset, `/` says the server is running.
    pub web_dir: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub enum AuthMode {
    /// `SOLSTICE_OIDC_*`: access tokens from Authentik.
    Oidc(OidcConfig),
    /// `SOLSTICE_DEV_USER` without OIDC: every request is this user. Local
    /// development only; logged loudly.
    Dev { username: String },
}

#[derive(Debug, Clone)]
pub struct OidcConfig {
    /// `SOLSTICE_OIDC_ISSUER`, e.g. `https://auth.jupiter.sunstead.net/application/o/solstice/`.
    pub issuer: String,
    /// `SOLSTICE_OIDC_CLIENT_ID` (the token audience), default `solstice`.
    pub client_id: String,
    /// `SOLSTICE_OIDC_SCOPES`, for apps to request; default
    /// `openid profile email offline_access`.
    pub scopes: String,
    /// `SOLSTICE_OIDC_ALLOWED_GROUPS`, comma separated. Empty: anyone the
    /// provider lets through (Authentik's policy binding is the first gate).
    pub allowed_groups: Vec<String>,
    /// `SOLSTICE_OIDC_DISCOVERY_URL`: when the server reaches the provider at
    /// another address than the issuer's.
    pub discovery_url: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("{name} is invalid: {reason}")]
    Invalid { name: &'static str, reason: String },
    #[error("set SOLSTICE_OIDC_ISSUER (or SOLSTICE_DEV_USER for local development)")]
    NoAuth,
}

struct Env<F>(F);

impl<F: Fn(&str) -> Option<String>> Env<F> {
    fn get(&self, name: &str) -> Option<String> {
        (self.0)(name)
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty())
    }
}

impl Config {
    /// `get` looks a variable up; tests pass a map instead of the environment.
    pub fn from_env(get: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let env = Env(get);
        let bind = match env.get("SOLSTICE_BIND") {
            Some(v) => v
                .parse()
                .map_err(|e: std::net::AddrParseError| ConfigError::Invalid {
                    name: "SOLSTICE_BIND",
                    reason: e.to_string(),
                })?,
            None => SocketAddr::from(([0, 0, 0, 0], 8080)),
        };
        let auth = match (
            env.get("SOLSTICE_OIDC_ISSUER"),
            env.get("SOLSTICE_DEV_USER"),
        ) {
            (Some(issuer), _) => {
                url::Url::parse(&issuer).map_err(|e| ConfigError::Invalid {
                    name: "SOLSTICE_OIDC_ISSUER",
                    reason: e.to_string(),
                })?;
                AuthMode::Oidc(OidcConfig {
                    issuer,
                    client_id: env
                        .get("SOLSTICE_OIDC_CLIENT_ID")
                        .unwrap_or_else(|| "solstice".into()),
                    scopes: env
                        .get("SOLSTICE_OIDC_SCOPES")
                        .unwrap_or_else(|| "openid profile email offline_access".into()),
                    allowed_groups: env
                        .get("SOLSTICE_OIDC_ALLOWED_GROUPS")
                        .map(|v| {
                            v.split(',')
                                .map(|g| g.trim().to_owned())
                                .filter(|g| !g.is_empty())
                                .collect()
                        })
                        .unwrap_or_default(),
                    discovery_url: env.get("SOLSTICE_OIDC_DISCOVERY_URL"),
                })
            }
            (None, Some(username)) => AuthMode::Dev { username },
            (None, None) => return Err(ConfigError::NoAuth),
        };
        let public_url = match env.get("SOLSTICE_PUBLIC_URL") {
            Some(v) => {
                let url = url::Url::parse(&v).map_err(|e| ConfigError::Invalid {
                    name: "SOLSTICE_PUBLIC_URL",
                    reason: e.to_string(),
                })?;
                if !matches!(url.scheme(), "http" | "https") || url.host().is_none() {
                    return Err(ConfigError::Invalid {
                        name: "SOLSTICE_PUBLIC_URL",
                        reason: "use an http(s) address, e.g. https://solstice.example".into(),
                    });
                }
                Some(url)
            }
            None => None,
        };
        Ok(Config {
            bind,
            public_url,
            web_dir: env.get("SOLSTICE_WEB_DIR").map(PathBuf::from),
            notes_dir: env
                .get("SOLSTICE_NOTES_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| ".data/notes".into()),
            state_dir: env
                .get("SOLSTICE_STATE_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| ".data/state".into()),
            auth,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config(vars: &[(&str, &str)]) -> Result<Config, ConfigError> {
        let map: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        Config::from_env(|k| map.get(k).cloned())
    }

    #[test]
    fn needs_a_way_to_sign_in() {
        assert!(matches!(config(&[]), Err(ConfigError::NoAuth)));
    }

    #[test]
    fn dev_mode_and_defaults() {
        let c = config(&[("SOLSTICE_DEV_USER", "pwb")]).unwrap();
        assert!(matches!(c.auth, AuthMode::Dev { ref username } if username == "pwb"));
        assert_eq!(c.bind.port(), 8080);
        assert_eq!(c.notes_dir, PathBuf::from(".data/notes"));
    }

    #[test]
    fn oidc_wins_over_dev() {
        let c = config(&[
            (
                "SOLSTICE_OIDC_ISSUER",
                "https://auth.example/application/o/solstice/",
            ),
            ("SOLSTICE_OIDC_ALLOWED_GROUPS", "homelab-users, ,family"),
            ("SOLSTICE_DEV_USER", "pwb"),
        ])
        .unwrap();
        let AuthMode::Oidc(o) = c.auth else {
            panic!("expected OIDC")
        };
        assert_eq!(o.client_id, "solstice");
        assert_eq!(o.allowed_groups, ["homelab-users", "family"]);
        assert!(config(&[("SOLSTICE_OIDC_ISSUER", "not a url")]).is_err());
    }

    #[test]
    fn public_url_must_be_http() {
        let dev = ("SOLSTICE_DEV_USER", "pwb");
        let c = config(&[dev, ("SOLSTICE_PUBLIC_URL", "https://solstice.example")]).unwrap();
        assert_eq!(c.public_url.unwrap().as_str(), "https://solstice.example/");
        assert!(config(&[dev, ("SOLSTICE_PUBLIC_URL", "ftp://x")]).is_err());
        assert!(config(&[dev, ("SOLSTICE_PUBLIC_URL", "nope")]).is_err());
        assert!(config(&[dev]).unwrap().public_url.is_none());
    }
}
