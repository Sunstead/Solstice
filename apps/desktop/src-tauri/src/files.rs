use std::{ fs, io::{ Read, Write }, path::{ Path, PathBuf } };

use crate::types::FileEntry;
use crate::watcher::note_self_write;

// Every mutating command below records what it touched via `note_self_write`,
// so the watcher can tell the app's own writes apart from someone else's and
// stay quiet about them. Tauri injects the `app` handle, so the generated
// TypeScript signatures are unaffected.

#[tauri::command]
#[specta::specta]
pub fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();

    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;

        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_dir: metadata.is_dir(),
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
#[specta::specta]
pub fn read_file(path: String) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;

    let mut contents = String::new();
    file.read_to_string(&mut contents).map_err(|e| e.to_string())?;

    Ok(contents)
}

#[tauri::command]
#[specta::specta]
pub fn write_file(app: tauri::AppHandle, path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut file = fs::File::create(&path).map_err(|e| e.to_string())?;
    file.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
    note_self_write(&app, Path::new(&path));
    // In a synced folder, the save merges with changes from other devices.
    crate::sync::saved(&app, &path, &contents);

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn create_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    fs::File::create(&path).map_err(|e| e.to_string())?;
    note_self_write(&app, Path::new(&path));

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn create_directory(app: tauri::AppHandle, path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    note_self_write(&app, Path::new(&path));

    Ok(())
}

/// Whether `a` and `b` name the same entry on disk. Used to let a case-only
/// rename through on case-insensitive filesystems (macOS, Windows), where the
/// destination "already exists" purely because it *is* the source.
fn is_same_entry(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

#[tauri::command]
#[specta::specta]
pub fn rename_path(app: tauri::AppHandle, old_path: String, new_path: String) -> Result<(), String> {
    let old = Path::new(&old_path);
    let new = Path::new(&new_path);

    // `fs::rename` silently clobbers an existing destination on Unix, so a
    // rename onto a sibling's name would destroy that sibling with no warning.
    if new.exists() && !is_same_entry(old, new) {
        let name = new.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(new_path.clone());
        return Err(format!("\"{name}\" already exists."));
    }

    fs::rename(old, new).map_err(|e| e.to_string())?;
    note_self_write(&app, old);
    note_self_write(&app, new);

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn delete_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| e.to_string())?;
    note_self_write(&app, Path::new(&path));

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn delete_directory(app: tauri::AppHandle, path: String, recursive: bool) -> Result<(), String> {
    (if recursive { fs::remove_dir_all(&path) } else { fs::remove_dir(&path) }).map_err(|e|
        e.to_string()
    )?;
    note_self_write(&app, Path::new(&path));

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn copy_path(app: tauri::AppHandle, from: String, to: String) -> Result<(), String> {
    let from = PathBuf::from(from);
    let to = PathBuf::from(to);

    if !from.is_file() {
        return Err("Directory copy is not implemented.".into());
    }

    fs::copy(&from, &to).map_err(|e| e.to_string())?;
    note_self_write(&app, &to);

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn move_path(app: tauri::AppHandle, from: String, to: String) -> Result<(), String> {
    fs::rename(&from, &to).map_err(|e| e.to_string())?;
    note_self_write(&app, Path::new(&from));
    note_self_write(&app, Path::new(&to));

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Moves an entry to the OS trash rather than unlinking it, so a mistaken
/// delete stays recoverable from Finder/Explorer. `delete_file` and
/// `delete_directory` remain the permanent-delete primitives.
#[tauri::command]
#[specta::specta]
pub fn trash_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())?;
    note_self_write(&app, Path::new(&path));

    Ok(())
}

/// Copies an entry alongside itself under a free name, returning the path it
/// landed at. Picking that name here rather than in the frontend keeps the
/// check and the create in one step -- a caller that probed for a free name
/// first could still lose the race to the watcher, another window, or Finder.
#[tauri::command]
#[specta::specta]
pub fn duplicate_path(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let source = Path::new(&path);

    if !source.exists() {
        return Err(format!("\"{path}\" no longer exists."));
    }

    let parent = source.parent().ok_or("Cannot duplicate the filesystem root.")?;
    let name = source
        .file_name()
        .ok_or("Cannot duplicate an entry with no name.")?
        .to_string_lossy()
        .into_owned();

    let destination = free_copy_path(parent, &name)?;

    if source.is_dir() {
        copy_dir_recursive(source, &destination)?;
    } else {
        fs::copy(source, &destination).map_err(|e| e.to_string())?;
    }

    note_self_write(&app, &destination);

    Ok(destination.to_string_lossy().into_owned())
}

/// Splits a trailing extension off a file name, keeping the dot with the
/// extension. A leading dot is part of the name, not a separator, so
/// `.gitignore` has no extension.
fn split_extension(name: &str) -> (&str, String) {
    match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem, format!(".{extension}")),
        _ => (name, String::new()),
    }
}

/// `note.md` -> `note copy.md`, then `note copy 2.md`, `note copy 3.md`...
/// Only the final extension is preserved, matching how the rest of the app
/// treats names (`stripPresetExtension` on the frontend does the same).
fn free_copy_path(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let (stem, extension) = split_extension(name);

    for attempt in 1..1000 {
        let suffix = if attempt == 1 { " copy".to_string() } else { format!(" copy {attempt}") };
        let candidate = parent.join(format!("{stem}{suffix}{extension}"));

        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!("Could not find a free name to duplicate \"{name}\" under."))
}

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| e.to_string())?;

    for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let destination = to.join(entry.file_name());

        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            copy_dir_recursive(&entry.path(), &destination)?;
        } else {
            fs::copy(entry.path(), &destination).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn list_workspace_files_recursive(path: String) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
 
    collect_entries_recursive(Path::new(&path), &mut entries)?;
 
    Ok(entries)
}
 
fn collect_entries_recursive(dir: &Path, entries: &mut Vec<FileEntry>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
 
        if name.starts_with('.') {
            continue;
        }
 
        let is_dir = metadata.is_dir();
        let path = entry.path();
 
        entries.push(FileEntry {
            name,
            path: path.to_string_lossy().into_owned(),
            is_dir,
        });
 
        if is_dir {
            collect_entries_recursive(&path, entries)?;
        }
    }
 
    Ok(())
}

/// Writes an attachment's bytes into `dir` under a free name derived from
/// `file_name`, creating the directory if it does not exist yet, and returns
/// the path it landed at.
///
/// The name is resolved here rather than on the frontend for the same reason
/// `duplicate_path` does it: a caller that probed for a free name first could
/// still lose the race to another window or to Finder.
#[tauri::command]
#[specta::specta]
pub fn save_attachment(
    app: tauri::AppHandle,
    dir: String,
    file_name: String,
    contents: Vec<u8>
) -> Result<String, String> {
    let dir = Path::new(&dir);
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    let destination = free_attachment_path(dir, &file_name)?;

    fs::write(&destination, &contents).map_err(|e| e.to_string())?;
    note_self_write(&app, &destination);

    Ok(destination.to_string_lossy().into_owned())
}

/// `image.png` -> `image.png`, then `image 1.png`, `image 2.png`...
/// Unlike `free_copy_path` the requested name is tried first: an attachment is
/// a new file rather than a copy of an existing one, so there is nothing for a
/// suffix to distinguish it from until a collision actually happens.
fn free_attachment_path(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let (stem, extension) = split_extension(name);

    for attempt in 0..1000 {
        let candidate = match attempt {
            0 => parent.join(name),
            n => parent.join(format!("{stem} {n}{extension}")),
        };

        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!("Could not find a free name to save \"{name}\" under."))
}

/// Copies a file that is already on disk into `into_dir`, under a free name,
/// and returns where it landed.
///
/// The counterpart to `save_attachment` for the file-picker path: the bytes
/// stay in the backend rather than making a round trip through the webview.
#[tauri::command]
#[specta::specta]
pub fn import_attachment(
    app: tauri::AppHandle,
    from: String,
    into_dir: String
) -> Result<String, String> {
    let source = Path::new(&from);

    if !source.is_file() {
        return Err(format!("\"{from}\" is not a file."));
    }

    let name = source
        .file_name()
        .ok_or("Cannot import an entry with no name.")?
        .to_string_lossy()
        .into_owned();

    let dir = Path::new(&into_dir);
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    let destination = free_attachment_path(dir, &name)?;

    fs::copy(source, &destination).map_err(|e| e.to_string())?;
    note_self_write(&app, &destination);

    Ok(destination.to_string_lossy().into_owned())
}
