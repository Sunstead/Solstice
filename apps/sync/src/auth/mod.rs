//! Who's calling. Apps present an Authentik access token and Atlas an API
//! token (`sst_...`), both as `Authorization: Bearer`, the WebSocket
//! included: tokens never go in URLs, where proxies and logs keep them. In
//! dev mode everyone is the dev user.

pub mod oidc;

use std::sync::Arc;

use axum::extract::FromRequestParts;
use axum::http::request::Parts;

use crate::config::{AuthMode, OidcConfig};
use crate::db::{Db, User, TOKEN_PREFIX};
use crate::error::AppError;
use oidc::{OidcVerifier, VerifyError};

pub enum Auth {
    Oidc {
        verifier: Arc<OidcVerifier>,
        config: OidcConfig,
    },
    Dev {
        username: String,
    },
}

impl Auth {
    pub fn new(mode: &AuthMode) -> Self {
        match mode {
            AuthMode::Oidc(config) => Auth::Oidc {
                verifier: Arc::new(OidcVerifier::new(config)),
                config: config.clone(),
            },
            AuthMode::Dev { username } => Auth::Dev {
                username: username.clone(),
            },
        }
    }

    pub fn start(&self) {
        if let Auth::Oidc { verifier, .. } = self {
            verifier.spawn_refresh();
        }
    }
}

/// How the caller signed in, which decides what they may do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Via {
    /// A Solstice app: everything on the user's own vaults.
    App,
    /// An API token with this scope: listing vaults and creating notes.
    Token(String),
}

#[derive(Debug, Clone)]
pub struct CurrentUser {
    pub user: User,
    pub via: Via,
    /// When the access token expires (Unix seconds); `None` for API tokens
    /// and dev sign-in. The sync WebSocket closes then.
    pub expires: Option<u64>,
}

impl CurrentUser {
    /// For everything an API token may not do.
    pub fn require_app(&self) -> Result<(), AppError> {
        match self.via {
            Via::App => Ok(()),
            Via::Token(_) => Err(AppError::forbidden(
                "API tokens can only list vaults and create notes",
            )),
        }
    }
}

/// A username names the user's folder, so it must be one safe path segment.
pub fn check_username(name: &str) -> Result<(), AppError> {
    let ok = solstice_core::VaultPath::parse(name)
        .is_ok_and(|p| !p.is_hidden() && !p.as_str().contains('/'));
    if ok {
        Ok(())
    } else {
        Err(AppError::forbidden(format!(
            "the username {name:?} can't be used as a folder name"
        )))
    }
}

fn presented_token(parts: &Parts) -> Option<String> {
    let value = parts
        .headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?;
    value.strip_prefix("Bearer ").map(|t| t.trim().to_owned())
}

impl FromRequestParts<crate::AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &crate::AppState,
    ) -> Result<Self, Self::Rejection> {
        authenticate(&state.auth, &state.db, presented_token(parts)).await
    }
}

pub async fn authenticate(
    auth: &Auth,
    db: &Db,
    token: Option<String>,
) -> Result<CurrentUser, AppError> {
    if let Some(token) = token.as_deref().filter(|t| t.starts_with(TOKEN_PREFIX)) {
        let (user, scope) = db
            .token_user(token)
            .await
            .map_err(|_| AppError::unauthorized("That API token isn't valid"))?;
        return Ok(CurrentUser {
            user,
            via: Via::Token(scope),
            expires: None,
        });
    }
    match auth {
        Auth::Dev { username } => {
            check_username(username)?;
            let user = db.user_for("dev", username, username).await?;
            Ok(CurrentUser {
                user,
                via: Via::App,
                expires: None,
            })
        }
        Auth::Oidc { verifier, config } => {
            let token = token.ok_or_else(|| AppError::unauthorized("Sign in to Solstice Sync"))?;
            let who = verifier.verify(&token).await.map_err(|e| match e {
                VerifyError::Invalid(m) => AppError::unauthorized(m),
                VerifyError::Unavailable(m) => {
                    AppError::new(crate::error::ErrorCode::Unavailable, m)
                }
            })?;
            if !config.allowed_groups.is_empty()
                && !who.groups.iter().any(|g| config.allowed_groups.contains(g))
            {
                return Err(AppError::forbidden(
                    "Your account isn't in a group allowed to use Solstice Sync",
                ));
            }
            check_username(&who.username)?;
            let user = db
                .user_for(&verifier.issuer, &who.subject, &who.username)
                .await?;
            Ok(CurrentUser {
                user,
                via: Via::App,
                expires: Some(who.expires),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usernames_must_be_safe_folder_names() {
        assert!(check_username("pwb").is_ok());
        assert!(check_username("first.last").is_ok());
        for bad in ["", "..", ".hidden", "a/b", "a\\b", "/root"] {
            assert!(check_username(bad).is_err(), "{bad:?}");
        }
    }
}
