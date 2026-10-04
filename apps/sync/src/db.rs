//! The state database: users, API tokens, vaults and each document's Yjs
//! state. Backed up (the `/state` volume). The vault files themselves are
//! the originals and live under the notes dir.
//!
//! One SQLite connection behind a mutex, used from `spawn_blocking`, as in
//! Atlas (`atlas-state`).

use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("database: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("not found")]
    NotFound,
    #[error("{0}")]
    Conflict(String),
    #[error("database task failed: {0}")]
    Task(String),
}

pub type Result<T> = std::result::Result<T, DbError>;

/// Each entry runs once, in order, tracked by `PRAGMA user_version`. Append
/// only: never edit a migration that has shipped.
const MIGRATIONS: &[&str] = &[
    // 0.1: users, API tokens, vaults, document state.
    "CREATE TABLE users (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        issuer     TEXT    NOT NULL,
        subject    TEXT    NOT NULL,
        username   TEXT    NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        UNIQUE (issuer, subject)
    );
    CREATE TABLE tokens (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash   BLOB    NOT NULL UNIQUE,
        user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        name         TEXT    NOT NULL,
        scope        TEXT    NOT NULL,
        created_at   INTEGER NOT NULL,
        last_used_at INTEGER
    );
    CREATE TABLE vaults (
        id         TEXT    PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        name       TEXT    NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (user_id, name)
    ) WITHOUT ROWID;
    CREATE TABLE docs (
        vault_id   TEXT    NOT NULL REFERENCES vaults (id) ON DELETE CASCADE,
        doc        TEXT    NOT NULL,
        epoch      INTEGER NOT NULL,
        state      BLOB    NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (vault_id, doc)
    ) WITHOUT ROWID;",
];

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// A random URL-safe token with `bytes` bytes of entropy.
pub fn random_token(bytes: usize) -> String {
    use base64::Engine;
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("the OS random number generator failed");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

/// API tokens carry this prefix, so they're recognisable (and never
/// mistaken for a JWT).
pub const TOKEN_PREFIX: &str = "sst_";

/// The scope every API token has for now: list vaults and create notes.
pub const SCOPE_NOTES_CREATE: &str = "notes:create";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct User {
    pub id: i64,
    pub username: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct VaultRow {
    pub id: String,
    pub name: String,
    #[serde(skip)]
    pub user_id: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TokenRow {
    pub id: i64,
    pub name: String,
    pub scope: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
}

/// A stored document: `doc` is `manifest` or a note's id.
#[derive(Debug, Clone)]
pub struct DocRow {
    pub doc: String,
    pub epoch: u32,
    pub state: Vec<u8>,
}

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

impl Db {
    pub fn open(dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(dir)
            .map_err(|e| DbError::Task(format!("{}: {e}", dir.display())))?;
        let conn = Connection::open(dir.join("sync.db"))?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> Result<Self> {
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
        migrate(&mut conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Runs `f` on the connection, off the async runtime.
    pub async fn call<T, F>(&self, f: F) -> Result<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> Result<T> + Send + 'static,
    {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let mut guard = conn.lock().unwrap_or_else(|p| p.into_inner());
            f(&mut guard)
        })
        .await
        .map_err(|e| DbError::Task(e.to_string()))?
    }

    /// The user with this identity, created on first sight. A username
    /// already taken by another identity is a conflict: it names their
    /// folder, so it can't be shared.
    pub async fn user_for(&self, issuer: &str, subject: &str, username: &str) -> Result<User> {
        let (issuer, subject, username) =
            (issuer.to_owned(), subject.to_owned(), username.to_owned());
        self.call(move |c| {
            let found = c
                .query_row(
                    "SELECT id, username FROM users WHERE issuer = ?1 AND subject = ?2",
                    params![issuer, subject],
                    |r| {
                        Ok(User {
                            id: r.get(0)?,
                            username: r.get(1)?,
                        })
                    },
                )
                .optional()?;
            if let Some(user) = found {
                return Ok(user);
            }
            let taken: bool = c.query_row(
                "SELECT EXISTS (SELECT 1 FROM users WHERE username = ?1)",
                [&username],
                |r| r.get(0),
            )?;
            if taken {
                return Err(DbError::Conflict(format!(
                    "the username {username} belongs to another account"
                )));
            }
            c.execute(
                "INSERT INTO users (issuer, subject, username, created_at) VALUES (?1, ?2, ?3, ?4)",
                params![issuer, subject, username, now()],
            )?;
            Ok(User {
                id: c.last_insert_rowid(),
                username,
            })
        })
        .await
    }

    // ------------------------------------------------------------ tokens

    /// Makes a token and returns it with its row. The token itself is never
    /// stored, only its SHA-256.
    pub async fn create_token(&self, user: i64, name: &str) -> Result<(String, TokenRow)> {
        let token = format!("{TOKEN_PREFIX}{}", random_token(32));
        let hash = Sha256::digest(token.as_bytes()).to_vec();
        let name = name.to_owned();
        let row = self
            .call(move |c| {
                let created_at = now();
                c.execute(
                    "INSERT INTO tokens (token_hash, user_id, name, scope, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![hash, user, name, SCOPE_NOTES_CREATE, created_at],
                )?;
                Ok(TokenRow {
                    id: c.last_insert_rowid(),
                    name,
                    scope: SCOPE_NOTES_CREATE.into(),
                    created_at,
                    last_used_at: None,
                })
            })
            .await?;
        Ok((token, row))
    }

    pub async fn tokens(&self, user: i64) -> Result<Vec<TokenRow>> {
        self.call(move |c| {
            let mut stmt = c.prepare(
                "SELECT id, name, scope, created_at, last_used_at FROM tokens WHERE user_id = ?1 ORDER BY id",
            )?;
            let rows = stmt
                .query_map([user], |r| {
                    Ok(TokenRow {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        scope: r.get(2)?,
                        created_at: r.get(3)?,
                        last_used_at: r.get(4)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .await
    }

    pub async fn delete_token(&self, user: i64, id: i64) -> Result<()> {
        let n = self
            .call(move |c| {
                Ok(c.execute(
                    "DELETE FROM tokens WHERE id = ?1 AND user_id = ?2",
                    params![id, user],
                )?)
            })
            .await?;
        if n == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    /// The user and scope behind an API token, marking it used.
    pub async fn token_user(&self, token: &str) -> Result<(User, String)> {
        let hash = Sha256::digest(token.as_bytes()).to_vec();
        self.call(move |c| {
            let found = c
                .query_row(
                    "SELECT u.id, u.username, t.scope, t.id FROM tokens t JOIN users u ON u.id = t.user_id
                     WHERE t.token_hash = ?1",
                    [&hash],
                    |r| Ok((User { id: r.get(0)?, username: r.get(1)? }, r.get::<_, String>(2)?, r.get::<_, i64>(3)?)),
                )
                .optional()?;
            let (user, scope, id) = found.ok_or(DbError::NotFound)?;
            c.execute("UPDATE tokens SET last_used_at = ?1 WHERE id = ?2", params![now(), id])?;
            Ok((user, scope))
        })
        .await
    }

    // ------------------------------------------------------------ vaults

    pub async fn vaults(&self, user: i64) -> Result<Vec<VaultRow>> {
        self.call(move |c| {
            let mut stmt =
                c.prepare("SELECT id, name, user_id FROM vaults WHERE user_id = ?1 ORDER BY name")?;
            let rows = stmt
                .query_map([user], |r| {
                    Ok(VaultRow {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        user_id: r.get(2)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .await
    }

    /// A vault, if it belongs to `user`.
    pub async fn vault(&self, user: i64, id: &str) -> Result<VaultRow> {
        let id = id.to_owned();
        self.call(move |c| {
            c.query_row(
                "SELECT id, name, user_id FROM vaults WHERE id = ?1 AND user_id = ?2",
                params![id, user],
                |r| {
                    Ok(VaultRow {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        user_id: r.get(2)?,
                    })
                },
            )
            .optional()?
            .ok_or(DbError::NotFound)
        })
        .await
    }

    pub async fn create_vault(&self, user: i64, name: &str) -> Result<VaultRow> {
        let name = name.to_owned();
        self.call(move |c| {
            let id = uuid::Uuid::new_v4().to_string();
            match c.execute(
                "INSERT INTO vaults (id, user_id, name, created_at) VALUES (?1, ?2, ?3, ?4)",
                params![id, user, name, now()],
            ) {
                Err(rusqlite::Error::SqliteFailure(e, _))
                    if e.code == rusqlite::ErrorCode::ConstraintViolation =>
                {
                    Err(DbError::Conflict(format!(
                        "there's already a vault called {name}"
                    )))
                }
                r => {
                    r?;
                    Ok(VaultRow {
                        id,
                        name,
                        user_id: user,
                    })
                }
            }
        })
        .await
    }

    // ------------------------------------------------------------ documents

    pub async fn docs(&self, vault: &str) -> Result<Vec<DocRow>> {
        let vault = vault.to_owned();
        self.call(move |c| {
            let mut stmt = c.prepare("SELECT doc, epoch, state FROM docs WHERE vault_id = ?1")?;
            let rows = stmt
                .query_map([vault], |r| {
                    Ok(DocRow {
                        doc: r.get(0)?,
                        epoch: r.get(1)?,
                        state: r.get(2)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .await
    }

    /// Saves documents' full state, in one transaction.
    pub async fn save_docs(&self, vault: &str, docs: Vec<DocRow>) -> Result<()> {
        if docs.is_empty() {
            return Ok(());
        }
        let vault = vault.to_owned();
        self.call(move |c| {
            let tx = c.transaction()?;
            {
                let mut stmt = tx.prepare(
                    "INSERT INTO docs (vault_id, doc, epoch, state, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT (vault_id, doc) DO UPDATE SET epoch = excluded.epoch, state = excluded.state,
                     updated_at = excluded.updated_at",
                )?;
                let t = now();
                for d in docs {
                    stmt.execute(params![vault, d.doc, d.epoch, d.state, t])?;
                }
            }
            tx.commit()?;
            Ok(())
        })
        .await
    }
}

fn migrate(conn: &mut Connection) -> Result<()> {
    let current: usize =
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? as usize;
    if current > MIGRATIONS.len() {
        return Err(DbError::Task(format!(
            "database is at version {current}, newer than this build ({}); refusing to run",
            MIGRATIONS.len()
        )));
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
        tracing::info!(version = i + 1, "state database migrated");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn users_are_one_per_identity_and_username() {
        let db = Db::open_in_memory().unwrap();
        let a = db.user_for("iss", "sub-a", "pwb").await.unwrap();
        assert_eq!(db.user_for("iss", "sub-a", "pwb").await.unwrap(), a);
        assert!(matches!(
            db.user_for("iss", "sub-b", "pwb").await,
            Err(DbError::Conflict(_))
        ));
    }

    #[tokio::test]
    async fn tokens_are_hashed_and_scoped_to_their_user() {
        let db = Db::open_in_memory().unwrap();
        let a = db.user_for("iss", "a", "alice").await.unwrap();
        let b = db.user_for("iss", "b", "bob").await.unwrap();
        let (token, row) = db.create_token(a.id, "Atlas").await.unwrap();
        assert!(token.starts_with(TOKEN_PREFIX));
        let (user, scope) = db.token_user(&token).await.unwrap();
        assert_eq!((user, scope.as_str()), (a.clone(), SCOPE_NOTES_CREATE));
        assert!(db.tokens(a.id).await.unwrap()[0].last_used_at.is_some());
        assert!(matches!(
            db.delete_token(b.id, row.id).await,
            Err(DbError::NotFound)
        ));
        db.delete_token(a.id, row.id).await.unwrap();
        assert!(matches!(
            db.token_user(&token).await,
            Err(DbError::NotFound)
        ));
    }

    #[tokio::test]
    async fn vaults_belong_to_their_user() {
        let db = Db::open_in_memory().unwrap();
        let a = db.user_for("iss", "a", "alice").await.unwrap();
        let b = db.user_for("iss", "b", "bob").await.unwrap();
        let v = db.create_vault(a.id, "Notes").await.unwrap();
        assert!(matches!(
            db.create_vault(a.id, "Notes").await,
            Err(DbError::Conflict(_))
        ));
        db.create_vault(b.id, "Notes").await.unwrap();
        assert_eq!(db.vault(a.id, &v.id).await.unwrap(), v);
        assert!(matches!(
            db.vault(b.id, &v.id).await,
            Err(DbError::NotFound)
        ));
        assert_eq!(db.vaults(a.id).await.unwrap(), [v]);
    }

    #[tokio::test]
    async fn saves_and_replaces_documents() {
        let db = Db::open_in_memory().unwrap();
        let a = db.user_for("iss", "a", "alice").await.unwrap();
        let v = db.create_vault(a.id, "Notes").await.unwrap();
        db.save_docs(
            &v.id,
            vec![DocRow {
                doc: "manifest".into(),
                epoch: 1,
                state: vec![1],
            }],
        )
        .await
        .unwrap();
        db.save_docs(
            &v.id,
            vec![DocRow {
                doc: "manifest".into(),
                epoch: 2,
                state: vec![2],
            }],
        )
        .await
        .unwrap();
        let docs = db.docs(&v.id).await.unwrap();
        assert_eq!(
            (docs.len(), docs[0].epoch, docs[0].state.clone()),
            (1, 2, vec![2])
        );
    }

    #[test]
    fn refuses_a_newer_database() {
        let dir = tempfile::tempdir().unwrap();
        drop(Db::open(dir.path()).unwrap());
        let conn = Connection::open(dir.path().join("sync.db")).unwrap();
        conn.pragma_update(None, "user_version", 999).unwrap();
        drop(conn);
        assert!(Db::open(dir.path()).is_err());
    }
}
