use std::{ fs, io::{ Read, Write }, path::{ Path, PathBuf } };

use crate::types::FileEntry;

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
pub fn write_file(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut file = fs::File::create(path).map_err(|e| e.to_string())?;
    file.write_all(contents.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn create_file(path: String) -> Result<(), String> {
    fs::File
        ::create(path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(old_path, new_path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_file(path: String) -> Result<(), String> {
    fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_directory(path: String, recursive: bool) -> Result<(), String> {
    (if recursive { fs::remove_dir_all(path) } else { fs::remove_dir(path) }).map_err(|e|
        e.to_string()
    )
}

#[tauri::command]
#[specta::specta]
pub fn copy_path(from: String, to: String) -> Result<(), String> {
    let from = PathBuf::from(from);
    let to = PathBuf::from(to);

    if from.is_file() {
        fs::copy(from, to)
            .map(|_| ())
            .map_err(|e| e.to_string())
    } else {
        Err("Directory copy is not implemented.".into())
    }
}

#[tauri::command]
#[specta::specta]
pub fn move_path(from: String, to: String) -> Result<(), String> {
    fs::rename(from, to).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn exists(path: String) -> bool {
    Path::new(&path).exists()
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