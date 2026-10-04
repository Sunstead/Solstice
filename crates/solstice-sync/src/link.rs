//! Linking a folder to a vault for the first time (or again, after the
//! server's manifest was rebuilt). Files on one side only are copied over;
//! files on both with different content are kept both ways: the server's
//! version keeps the name and this device's moves beside it.

use std::collections::{BTreeMap, BTreeSet};

use crate::manifest::{numbered, FileId};
use crate::vault::{content_hash, Content, Vault};

/// A file in the local folder.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalFile {
    /// Vault-relative, `/`-separated.
    pub path: String,
    /// [`content_hash`] of its bytes.
    pub hash: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LinkStep {
    /// The same on both sides: nothing to move.
    Same { id: FileId, path: String },
    /// Only on the server: write it here. `path` is the server's.
    Download { id: FileId, path: String },
    /// Only here: add it to the vault.
    Upload { path: String },
    /// Different on each side: rename the local file to `copy` and upload it
    /// as a new file, then download the server's to `path`.
    KeepBoth {
        id: FileId,
        path: String,
        copy: String,
    },
}

/// What to do with each file. `vault` is the server's vault, freshly synced.
pub fn plan_link(vault: &Vault, local: &[LocalFile]) -> Vec<LinkStep> {
    let server: BTreeMap<String, (String, FileId, String)> = vault
        .files()
        .into_iter()
        .map(|(path, (id, content))| {
            let hash = match content {
                Content::Note(text) => content_hash(text.as_bytes()),
                Content::Blob(hash) => hash,
            };
            (path.to_lowercase(), (path, id, hash))
        })
        .collect();
    let mut taken: BTreeSet<String> = server.keys().cloned().collect();
    taken.extend(local.iter().map(|f| f.path.to_lowercase()));

    let mut steps = Vec::new();
    let mut matched = BTreeSet::new();
    for file in local {
        let key = file.path.to_lowercase();
        match server.get(&key) {
            None => steps.push(LinkStep::Upload {
                path: file.path.clone(),
            }),
            Some((path, id, hash)) => {
                matched.insert(key);
                if *hash == file.hash {
                    steps.push(LinkStep::Same {
                        id: id.clone(),
                        path: path.clone(),
                    });
                } else {
                    let copy = free_copy_path(&file.path, &mut taken);
                    steps.push(LinkStep::KeepBoth {
                        id: id.clone(),
                        path: path.clone(),
                        copy,
                    });
                }
            }
        }
    }
    for (key, (path, id, _)) in &server {
        if !matched.contains(key) {
            steps.push(LinkStep::Download {
                id: id.clone(),
                path: path.clone(),
            });
        }
    }
    steps
}

fn free_copy_path(path: &str, taken: &mut BTreeSet<String>) -> String {
    let name_start = path.rfind('/').map_or(0, |i| i + 1);
    let (stem, ext) = match path[name_start..].rfind('.') {
        Some(dot) if dot > 0 => path.split_at(name_start + dot),
        _ => (path, ""),
    };
    let first = format!("{stem} (this device){ext}");
    let mut candidate = first.clone();
    let mut n = 2;
    while !taken.insert(candidate.to_lowercase()) {
        candidate = numbered(&first, n);
        n += 1;
    }
    candidate
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local(path: &str, text: &str) -> LocalFile {
        LocalFile {
            path: path.into(),
            hash: content_hash(text.as_bytes()),
        }
    }

    #[test]
    fn plans_each_case() {
        let mut vault = Vault::new("server");
        let (same, _) = vault.create_note("Same.md", "same text").unwrap();
        let (differs, _) = vault.create_note("Plan.md", "server plan").unwrap();
        let (remote_only, _) = vault.create_note("notes/Remote.md", "only there").unwrap();
        vault
            .create_note("Plan (this device).md", "already taken")
            .unwrap();

        let steps = plan_link(
            &vault,
            &[
                local("same.md", "same text"),
                local("Plan.md", "my plan"),
                local("Local.md", "only here"),
            ],
        );
        assert!(steps.contains(&LinkStep::Same {
            id: same,
            path: "Same.md".into()
        }));
        assert!(steps.contains(&LinkStep::KeepBoth {
            id: differs,
            path: "Plan.md".into(),
            copy: "Plan (this device) 2.md".into(),
        }));
        assert!(steps.contains(&LinkStep::Upload {
            path: "Local.md".into()
        }));
        assert!(steps.contains(&LinkStep::Download {
            id: remote_only,
            path: "notes/Remote.md".into()
        }));
    }
}
