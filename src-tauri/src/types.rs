use serde::{ Deserialize, Serialize };
use ts_rs::TS;

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../src/generated/")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}
