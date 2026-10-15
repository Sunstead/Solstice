//! Solstice's native pieces on iOS, as a Tauri plugin: a Swift package
//! (`ios/`) the app calls through [`NativeExt`]. On other platforms it
//! registers nothing and every call says so.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_solstice_native);

#[cfg(target_os = "ios")]
mod pdf;

pub struct Native<R: Runtime> {
    #[cfg(target_os = "ios")]
    handle: tauri::plugin::PluginHandle<R>,
    #[cfg(not(target_os = "ios"))]
    _runtime: std::marker::PhantomData<fn() -> R>,
}

#[cfg(target_os = "ios")]
#[derive(serde::Serialize)]
struct UrlArgs<'a> {
    url: &'a str,
}

impl<R: Runtime> Native<R> {
    /// Shows `url` in the system's sign-in sheet and blocks until it closes:
    /// `Ok` when [`Self::dismiss_authentication`] closed it, `Err` when the
    /// person did. Call it off the async runtime.
    pub fn authenticate(&self, url: &str) -> Result<(), String> {
        #[cfg(target_os = "ios")]
        return self
            .handle
            .run_mobile_plugin::<serde_json::Value>("authenticate", UrlArgs { url })
            .map(|_| ())
            .map_err(|e| e.to_string());
        #[cfg(not(target_os = "ios"))]
        {
            let _ = url;
            Err(unavailable())
        }
    }

    /// Closes the sign-in sheet, once the redirect it was waiting for came.
    pub fn dismiss_authentication(&self) -> Result<(), String> {
        #[cfg(target_os = "ios")]
        return self
            .handle
            .run_mobile_plugin::<serde_json::Value>("dismissAuthentication", ())
            .map(|_| ())
            .map_err(|e| e.to_string());
        #[cfg(not(target_os = "ios"))]
        Err(unavailable())
    }
}

#[cfg(not(target_os = "ios"))]
fn unavailable() -> String {
    "Only the iOS app has this.".into()
}

pub trait NativeExt<R: Runtime> {
    fn native(&self) -> &Native<R>;
}

impl<R: Runtime, T: Manager<R>> NativeExt<R> for T {
    fn native(&self) -> &Native<R> {
        self.state::<Native<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("solstice-native")
        .setup(|app, _api| {
            #[cfg(target_os = "ios")]
            let native = Native {
                handle: _api.register_ios_plugin(init_plugin_solstice_native)?,
            };
            #[cfg(not(target_os = "ios"))]
            let native = Native::<R> {
                _runtime: std::marker::PhantomData,
            };
            app.manage(native);
            Ok(())
        })
        .build()
}
