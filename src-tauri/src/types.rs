use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}