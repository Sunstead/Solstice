//! The sync sign-in's refresh token, in the operating system's credential
//! store: macOS Keychain, Windows Credential Manager, or the Secret Service
//! on Linux. Only Rust touches it. Ported from Cosmos.

const SERVICE: &str = "net.sunstead.solstice";

/// The error as the user should read it. On Linux the store is a keyring
/// service (GNOME Keyring, KWallet) that a minimal desktop may not run, and
/// the D-Bus error says nothing of that.
fn explain(e: keyring::Error, linux: bool) -> String {
    match e {
        keyring::Error::PlatformFailure(_) | keyring::Error::NoStorageAccess(_) if linux => format!(
            "Solstice keeps your sign-in in the system keyring, and none answered. Install or start GNOME Keyring or KWallet, then try again. ({e})"
        ),
        e => e.to_string(),
    }
}

fn describe(e: keyring::Error) -> String {
    explain(e, cfg!(target_os = "linux"))
}

fn entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, account).map_err(describe)
}

/// `Ok(None)` when there's nothing stored, which is the signed-out state.
pub fn get(account: &str) -> Result<Option<String>, String> {
    match entry(account)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(describe(e)),
    }
}

pub fn set(account: &str, value: &str) -> Result<(), String> {
    entry(account)?.set_password(value).map_err(describe)
}

pub fn delete(account: &str) -> Result<(), String> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(describe(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unavailable() -> keyring::Error {
        keyring::Error::PlatformFailure("org.freedesktop.DBus.Error.ServiceUnknown".into())
    }

    #[test]
    fn says_on_linux_that_a_keyring_is_needed() {
        let message = explain(unavailable(), true);
        assert!(message.contains("GNOME Keyring or KWallet"), "{message}");
        assert!(message.contains("ServiceUnknown"), "keeps the cause: {message}");
    }

    #[test]
    fn leaves_other_systems_errors_as_they_are() {
        assert_eq!(explain(unavailable(), false), unavailable().to_string());
        assert_eq!(explain(keyring::Error::NoEntry, true), keyring::Error::NoEntry.to_string());
    }
}
