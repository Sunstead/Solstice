//! Talking to a Solstice Sync server: its HTTP API and the sync WebSocket.

use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use url::Url;

use crate::Error;

pub type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Where access tokens come from. The desktop app refreshes its Authentik
/// sign-in; `Ok(None)` means none (signed out, or a development server that
/// needs none).
pub trait TokenSource: Send + Sync {
    fn token(&self) -> BoxFuture<'_, Result<Option<String>, String>>;
}

/// No tokens: for development servers (`SOLSTICE_DEV_USER`) and tests.
pub struct NoTokens;

impl TokenSource for NoTokens {
    fn token(&self) -> BoxFuture<'_, Result<Option<String>, String>> {
        Box::pin(async { Ok(None) })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultInfo {
    pub id: String,
    pub name: String,
}

/// How to sign in to a server, from its `/v1/info`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthInfo {
    Oidc {
        issuer: String,
        client_id: String,
        scopes: String,
    },
    /// A development server: everyone is one user, no sign-in.
    Dev,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ServerInfo {
    pub version: String,
    pub protocol: u16,
    pub auth: AuthInfo,
}

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(d)) => d.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

#[derive(Clone)]
pub struct Server {
    base: Url,
    http: reqwest::Client,
}

#[derive(Deserialize)]
struct ApiError {
    message: String,
}

impl Server {
    pub fn new(base: &str) -> Result<Self, Error> {
        crate::install_crypto();
        let mut base = Url::parse(base.trim()).map_err(|e| Error::BadServer(e.to_string()))?;
        match base.scheme() {
            "https" => {}
            // Plain HTTP would carry sign-in tokens and notes in the clear:
            // only for a server on this machine (development).
            "http" if is_loopback(&base) => {}
            "http" => {
                return Err(Error::BadServer(
                    "use an https:// address (http:// is only for a server on this computer)"
                        .into(),
                ))
            }
            _ => return Err(Error::BadServer("use an https:// address".into())),
        }
        if !base.path().ends_with('/') {
            base.set_path(&format!("{}/", base.path()));
        }
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| Error::Network(e.to_string()))?;
        Ok(Self { base, http })
    }

    pub fn url(&self) -> &str {
        self.base.as_str().trim_end_matches('/')
    }

    fn endpoint(&self, path: &str) -> Url {
        self.base.join(path).expect("relative paths join")
    }

    async fn check(res: reqwest::Response) -> Result<reqwest::Response, Error> {
        let status = res.status();
        if status.is_success() {
            return Ok(res);
        }
        let message = res
            .json::<ApiError>()
            .await
            .map(|e| e.message)
            .unwrap_or_else(|_| status.to_string());
        Err(match status.as_u16() {
            401 => Error::SignedOut,
            404 => Error::NotFound(message),
            _ => Error::Server {
                status: status.as_u16(),
                message,
            },
        })
    }

    fn authed(req: reqwest::RequestBuilder, token: Option<&str>) -> reqwest::RequestBuilder {
        match token {
            Some(t) => req.bearer_auth(t),
            None => req,
        }
    }

    async fn send(
        &self,
        req: reqwest::RequestBuilder,
        token: Option<&str>,
    ) -> Result<reqwest::Response, Error> {
        Self::check(
            Self::authed(req, token)
                .send()
                .await
                .map_err(|e| Error::Network(e.to_string()))?,
        )
        .await
    }

    pub async fn info(&self) -> Result<ServerInfo, Error> {
        let res = self
            .send(self.http.get(self.endpoint("v1/info")), None)
            .await?;
        let info: ServerInfo = res
            .json()
            .await
            .map_err(|e| Error::BadServer(e.to_string()))?;
        if info.protocol != solstice_sync::PROTOCOL {
            return Err(Error::BadServer(format!(
                "the server speaks sync protocol {}, this app {}; update whichever is older",
                info.protocol,
                solstice_sync::PROTOCOL
            )));
        }
        Ok(info)
    }

    pub async fn vaults(&self, token: Option<&str>) -> Result<Vec<VaultInfo>, Error> {
        let res = self
            .send(self.http.get(self.endpoint("v1/vaults")), token)
            .await?;
        res.json()
            .await
            .map_err(|e| Error::BadServer(e.to_string()))
    }

    pub async fn create_vault(&self, token: Option<&str>, name: &str) -> Result<VaultInfo, Error> {
        let req = self
            .http
            .post(self.endpoint("v1/vaults"))
            .json(&serde_json::json!({ "name": name }));
        let res = self.send(req, token).await?;
        res.json()
            .await
            .map_err(|e| Error::BadServer(e.to_string()))
    }

    /// An API token for Atlas. Shown once; the server keeps only its hash.
    pub async fn create_token(&self, token: Option<&str>, name: &str) -> Result<String, Error> {
        let req = self
            .http
            .post(self.endpoint("v1/tokens"))
            .json(&serde_json::json!({ "name": name }));
        let body: serde_json::Value = self
            .send(req, token)
            .await?
            .json()
            .await
            .map_err(|e| Error::BadServer(e.to_string()))?;
        body["token"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| Error::BadServer("no token in the reply".into()))
    }

    pub async fn put_blob(
        &self,
        token: Option<&str>,
        vault: &str,
        hash: &str,
        bytes: Vec<u8>,
    ) -> Result<(), Error> {
        let req = self
            .http
            .put(self.endpoint(&format!("v1/vaults/{vault}/blobs/{hash}")))
            .body(bytes);
        self.send(req, token).await.map(|_| ())
    }

    pub async fn get_blob(
        &self,
        token: Option<&str>,
        vault: &str,
        hash: &str,
    ) -> Result<Vec<u8>, Error> {
        if !solstice_sync::is_content_hash(hash) {
            return Err(Error::BadServer(format!("{hash:?} isn't a content hash")));
        }
        let req = self
            .http
            .get(self.endpoint(&format!("v1/vaults/{vault}/blobs/{hash}")));
        let bytes = self
            .send(req, token)
            .await?
            .bytes()
            .await
            .map_err(|e| Error::Network(e.to_string()))?;
        if solstice_sync::content_hash(&bytes) != hash {
            return Err(Error::BadServer(
                "an attachment didn't match its hash".into(),
            ));
        }
        Ok(bytes.to_vec())
    }

    /// Opens the sync WebSocket, with the token in the `Authorization`
    /// header like every other request (never the URL).
    pub async fn connect(&self, token: Option<&str>) -> Result<Socket, Error> {
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        use tokio_tungstenite::tungstenite::http::HeaderValue;

        let mut url = self.endpoint("v1/sync");
        let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
        url.set_scheme(scheme).expect("ws schemes are valid");
        let mut req = url
            .as_str()
            .into_client_request()
            .map_err(|e| Error::BadServer(e.to_string()))?;
        if let Some(token) = token {
            let value =
                HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| Error::SignedOut)?;
            req.headers_mut().insert("authorization", value);
        }
        match tokio_tungstenite::connect_async(req).await {
            Ok((socket, _)) => Ok(socket),
            Err(tokio_tungstenite::tungstenite::Error::Http(res))
                if res.status().as_u16() == 401 =>
            {
                Err(Error::SignedOut)
            }
            Err(e) => Err(Error::Network(e.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_http_only_on_this_machine() {
        for ok in [
            "https://solstice.jupiter.sunstead.net",
            "http://localhost:8080",
            "http://127.0.0.1:8080/",
            "http://[::1]:8080",
        ] {
            assert!(Server::new(ok).is_ok(), "{ok}");
        }
        for bad in [
            "http://solstice.jupiter.sunstead.net",
            "http://100.64.0.1:8080",
            "ftp://example.com",
            "not a url",
        ] {
            assert!(Server::new(bad).is_err(), "{bad}");
        }
    }
}
