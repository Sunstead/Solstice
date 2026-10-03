use font_kit::source::SystemSource;

/// Every font family installed on this machine, sorted and deduplicated.
///
/// Enumerating families walks the system font directories, which is slow
/// enough to be worth keeping off the startup path -- the frontend calls this
/// lazily the first time a font control is opened and caches the result.
#[tauri::command]
#[specta::specta]
pub fn list_system_fonts() -> Result<Vec<String>, String> {
    let mut families = SystemSource::new().all_families().map_err(|e| e.to_string())?;

    families.sort_by_key(|name| name.to_lowercase());
    families.dedup();
    // Families whose name starts with a dot are the system's hidden fallbacks
    // (`.SF NS`, `.LastResort`); they are not selectable faces.
    families.retain(|name| !name.starts_with('.'));

    Ok(families)
}
