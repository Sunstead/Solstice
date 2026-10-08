//! `[[target]]` links: finding them in markdown, splitting their parts and
//! resolving them against the files in a vault.
//!
//! Mirrors the desktop app (`lib/wikilink/target.ts`,
//! `lib/stores/wikilink-index.ts`).

use std::collections::BTreeMap;

use crate::path::strip_implicit_extension;

/// Canonical form of a target: `/` separators, no leading `./` or `/`, no
/// repeated or trailing `/`, trimmed. Matches `normalizeTarget`.
pub fn normalize_target(raw: &str) -> String {
    let unified = raw.trim().replace('\\', "/");
    let mut out = String::with_capacity(unified.len());
    for c in unified.chars() {
        if c == '/' && out.ends_with('/') {
            continue;
        }
        out.push(c);
    }
    let out = out
        .strip_prefix("./")
        .or_else(|| out.strip_prefix('/'))
        .unwrap_or(&out);
    out.trim_end_matches('/').to_string()
}

/// Lookup key: normalized and lowercased, since a vault is edited from both
/// case-sensitive and case-insensitive file systems.
fn index_key(value: &str) -> String {
    normalize_target(value).to_lowercase()
}

fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WikilinkParts {
    /// The file part, with no heading or suffix. Empty for `[[#here]]`.
    pub path: String,
    pub heading: Option<String>,
    /// A block reference, `#^id`, without its `^`. A link has a heading or a
    /// block, never both.
    pub block: Option<String>,
    /// Text after `|`: a display alias on a link, a size on an embed.
    pub suffix: Option<String>,
}

/// Splits `notes/spec#Design|400` into its parts. Resolve `parts.path`, not
/// the raw target. Matches `parseWikilinkTarget`.
pub fn parse_target(raw: &str) -> WikilinkParts {
    let (head, suffix) = match raw.find('|') {
        Some(i) => (&raw[..i], Some(raw[i + 1..].to_string())),
        None => (raw, None),
    };
    let (path, anchor) = match head.find('#') {
        Some(i) => {
            let anchor = head[i + 1..].trim();
            (&head[..i], (!anchor.is_empty()).then_some(anchor))
        }
        None => (head, None),
    };
    let (heading, block) = match anchor {
        Some(a) => match a.strip_prefix('^') {
            Some(id) => (None, (!id.is_empty()).then(|| id.to_string())),
            None => (Some(a.to_string()), None),
        },
        None => (None, None),
    };
    WikilinkParts {
        path: path.trim().to_string(),
        heading,
        block,
        suffix,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WikilinkMatch {
    /// Byte range of the whole construct, `!` included for an embed.
    pub start: usize,
    pub end: usize,
    /// The raw text between the brackets.
    pub target: String,
    /// `![[...]]`
    pub embed: bool,
}

/// Every wikilink and embed in a markdown document, in order. A target is
/// one line with no brackets in it. Fenced code blocks and inline code are
/// skipped, as the editor never forms links there.
pub fn find_wikilinks(markdown: &str) -> Vec<WikilinkMatch> {
    let mut found = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    let mut line_start = 0;

    for line in markdown.split_inclusive('\n') {
        let trimmed = line.trim_start();
        let indent = line.len() - trimmed.len();
        let fence_char = trimmed.chars().next().filter(|c| *c == '`' || *c == '~');
        let run = fence_char.map_or(0, |c| trimmed.chars().take_while(|x| *x == c).count());

        match fence {
            Some((c, len)) => {
                if indent < 4
                    && fence_char == Some(c)
                    && run >= len
                    && trimmed[run..].trim().is_empty()
                {
                    fence = None;
                }
            }
            None if indent < 4 && run >= 3 => fence = Some((fence_char.unwrap(), run)),
            None => scan_line(line, line_start, &mut found),
        }
        line_start += line.len();
    }
    found
}

fn scan_line(line: &str, offset: usize, found: &mut Vec<WikilinkMatch>) {
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'`' => {
                // Skip an inline code span: a run of backticks to the same run.
                let run = bytes[i..].iter().take_while(|b| **b == b'`').count();
                let ticks = &line[i..i + run];
                match line[i + run..].find(ticks) {
                    Some(close) => i += run + close + run,
                    None => i += run,
                }
            }
            b'[' if bytes.get(i + 1) == Some(&b'[') => {
                let body_start = i + 2;
                let close = line[body_start..].find(['[', ']', '\n']);
                match close {
                    Some(len) if len > 0 && line[body_start + len..].starts_with("]]") => {
                        let embed = i > 0 && bytes[i - 1] == b'!';
                        let start = if embed { i - 1 } else { i };
                        let end = body_start + len + 2;
                        found.push(WikilinkMatch {
                            start: offset + start,
                            end: offset + end,
                            target: line[body_start..body_start + len].to_string(),
                            embed,
                        });
                        i = end;
                    }
                    _ => i += 1,
                }
            }
            _ => i += 1,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Resolution {
    Resolved(String),
    /// More than one file answers to the target, in path order.
    Ambiguous(Vec<String>),
    Unresolved,
}

/// The files of a vault, indexed for link resolution: exact path, then path
/// without an implicit extension, then bare name. A bare name only resolves
/// while exactly one file has it. Matches `buildSnapshot`/`resolveWikilink`.
#[derive(Clone, Debug, Default)]
pub struct WikilinkIndex {
    by_path: BTreeMap<String, String>,
    by_stem: BTreeMap<String, Vec<String>>,
    by_name: BTreeMap<String, Vec<String>>,
}

impl WikilinkIndex {
    pub fn new<I, S>(paths: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut sorted: Vec<String> = paths.into_iter().map(|p| p.as_ref().to_string()).collect();
        sorted.sort();
        let mut index = Self::default();
        for path in sorted {
            index.by_path.insert(index_key(&path), path.clone());
            let stem = strip_implicit_extension(&path);
            index
                .by_stem
                .entry(index_key(stem))
                .or_default()
                .push(path.clone());
            let name = strip_implicit_extension(basename(&path));
            index
                .by_name
                .entry(index_key(name))
                .or_default()
                .push(path.clone());
        }
        index
    }

    /// Resolves a target's path part (see [`parse_target`]).
    pub fn resolve(&self, target: &str) -> Resolution {
        let normalized = normalize_target(target);
        if normalized.is_empty() {
            return Resolution::Unresolved;
        }
        if let Some(exact) = self.by_path.get(&index_key(&normalized)) {
            return Resolution::Resolved(exact.clone());
        }
        let table = if normalized.contains('/') {
            &self.by_stem
        } else {
            &self.by_name
        };
        match table.get(&index_key(&normalized)).map(Vec::as_slice) {
            Some([one]) => Resolution::Resolved(one.clone()),
            Some(many) if many.len() > 1 => Resolution::Ambiguous(many.to_vec()),
            _ => Resolution::Unresolved,
        }
    }

    /// The shortest target that refers to `path` unambiguously: the bare name
    /// where unique, the path without its implicit extension otherwise.
    pub fn shortest_target(&self, path: &str) -> String {
        let normalized = normalize_target(path);
        let stem = strip_implicit_extension(&normalized);
        let name = basename(stem);
        let same_name = self.by_name.get(&index_key(name)).map_or(0, Vec::len);
        if same_name > 1 { stem } else { name }.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_targets() {
        assert_eq!(normalize_target(" ./notes\\todo.md "), "notes/todo.md");
        assert_eq!(normalize_target("/notes//sub/"), "notes/sub");
        assert_eq!(normalize_target("todo"), "todo");
    }

    #[test]
    fn splits_path_heading_and_suffix() {
        let p = parse_target("notes/spec#Design|400");
        assert_eq!(
            (p.path.as_str(), p.heading.as_deref(), p.suffix.as_deref()),
            ("notes/spec", Some("Design"), Some("400"))
        );
        assert_eq!(
            parse_target("#here"),
            WikilinkParts {
                path: String::new(),
                heading: Some("here".into()),
                block: None,
                suffix: None
            }
        );
        let p = parse_target("notes/spec#^a1b2|Alias");
        assert_eq!(
            (p.path.as_str(), p.heading, p.block.as_deref(), p.suffix.as_deref()),
            ("notes/spec", None, Some("a1b2"), Some("Alias"))
        );
        assert_eq!(parse_target("todo#^").block, None);
        assert_eq!(
            parse_target("todo|the list").suffix.as_deref(),
            Some("the list")
        );
        assert_eq!(parse_target("todo#").heading, None);
    }

    #[test]
    fn finds_links_and_embeds() {
        let text = "See [[todo]] and ![[diagram.png]], not [[a\nb]] or [[x[y]].";
        let found = find_wikilinks(text);
        let summary: Vec<_> = found.iter().map(|m| (m.target.as_str(), m.embed)).collect();
        assert_eq!(summary, [("todo", false), ("diagram.png", true)]);
        assert_eq!(&text[found[0].start..found[0].end], "[[todo]]");
        assert_eq!(&text[found[1].start..found[1].end], "![[diagram.png]]");
    }

    #[test]
    fn skips_code() {
        let text = "[[a]] `[[b]]` ``x [[c]] x``\n```\n[[d]]\n```\n~~~~\n[[e]]\n```\n~~~~\n[[f]]";
        let targets: Vec<_> = find_wikilinks(text).into_iter().map(|m| m.target).collect();
        assert_eq!(targets, ["a", "f"]);
    }

    #[test]
    fn reports_offsets_across_lines() {
        let text = "first\nsecond [[two]]\n";
        let m = &find_wikilinks(text)[0];
        assert_eq!(&text[m.start..m.end], "[[two]]");
    }

    fn index() -> WikilinkIndex {
        WikilinkIndex::new([
            "todo.md",
            "notes/Spec.md",
            "notes/ideas.md",
            "archive/ideas.md",
            "boards/plan.canvas",
            "images/diagram.png",
        ])
    }

    fn resolved(path: &str) -> Resolution {
        Resolution::Resolved(path.to_string())
    }

    #[test]
    fn resolves_like_the_desktop_app() {
        let index = index();
        assert_eq!(index.resolve("notes/ideas.md"), resolved("notes/ideas.md"));
        assert_eq!(
            index.resolve("images/diagram.png"),
            resolved("images/diagram.png")
        );
        assert_eq!(index.resolve("archive/ideas"), resolved("archive/ideas.md"));
        assert_eq!(index.resolve("boards/plan"), resolved("boards/plan.canvas"));
        assert_eq!(index.resolve("todo"), resolved("todo.md"));
        assert_eq!(index.resolve("plan"), resolved("boards/plan.canvas"));
        assert_eq!(
            index.resolve("ideas"),
            Resolution::Ambiguous(vec!["archive/ideas.md".into(), "notes/ideas.md".into()])
        );
        assert_eq!(index.resolve("SPEC"), resolved("notes/Spec.md"));
        assert_eq!(index.resolve("Notes/spec"), resolved("notes/Spec.md"));
        assert_eq!(index.resolve(" ./notes\\Spec "), resolved("notes/Spec.md"));
        assert_eq!(index.resolve("missing"), Resolution::Unresolved);
        assert_eq!(index.resolve("notes/todo"), Resolution::Unresolved);
        assert_eq!(index.resolve("  "), Resolution::Unresolved);
    }

    #[test]
    fn picks_the_shortest_target() {
        let index = index();
        assert_eq!(index.shortest_target("notes/Spec.md"), "Spec");
        assert_eq!(index.shortest_target("notes/ideas.md"), "notes/ideas");
    }
}
