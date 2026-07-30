use serde::Deserialize;
use std::{ fs, io::{ Read, Write }, path::{ Path, PathBuf } };

use crate::types::FileEntry;

#[derive(Debug, Deserialize)]
pub struct WriteFileRequest {
    pub path: String,
    pub contents: String,
}

#[tauri::command]
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
pub fn read_file(path: String) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;

    let mut contents = String::new();
    file.read_to_string(&mut contents).map_err(|e| e.to_string())?;

    Ok(contents)
}

#[tauri::command]
pub fn write_file(request: WriteFileRequest) -> Result<(), String> {
    if let Some(parent) = Path::new(&request.path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut file = fs::File::create(request.path).map_err(|e| e.to_string())?;
    file.write_all(request.contents.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_file(path: String) -> Result<(), String> {
    fs::File
        ::create(path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(old_path, new_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_directory(path: String, recursive: bool) -> Result<(), String> {
    (if recursive { fs::remove_dir_all(path) } else { fs::remove_dir(path) }).map_err(|e|
        e.to_string()
    )
}

#[tauri::command]
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
pub fn move_path(from: String, to: String) -> Result<(), String> {
    fs::rename(from, to).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn exists(path: String) -> bool {
    Path::new(&path).exists()
}
