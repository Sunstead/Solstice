//! The sync sign-in's refresh token, in the operating system's credential
//! store: macOS Keychain, Windows Credential Manager, or the Secret Service
//! on Linux. Only Rust touches it. Ported from Cosmos.

const SERVICE: &str = "net.sunstead.solstice";

fn entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())
}

/// `Ok(None)` when there's nothing stored, which is the signed-out state.
pub fn get(account: &str) -> Result<Option<String>, String> {
    match entry(account)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn set(account: &str, value: &str) -> Result<(), String> {
    entry(account)?.set_password(value).map_err(|e| e.to_string())
}

pub fn delete(account: &str) -> Result<(), String> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
