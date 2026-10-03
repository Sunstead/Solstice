//! Just enough markdown for indexing and listing notes: front matter and a
//! title. Front matter is read, never written: Solstice keeps notes free of
//! metadata it adds itself.

/// A note's YAML front matter, unparsed: the text between the opening and
/// closing `---` lines.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FrontMatter<'a> {
    pub raw: &'a str,
}

impl<'a> FrontMatter<'a> {
    /// A top-level `key: value` scalar, unquoted. Enough for `title:`; lists,
    /// maps and multi-line values return `None`.
    pub fn get(&self, key: &str) -> Option<&'a str> {
        self.raw.lines().find_map(|line| {
            let rest = line.strip_prefix(key)?.strip_prefix(':')?;
            let value = rest.trim();
            let value = value
                .strip_prefix('"')
                .and_then(|v| v.strip_suffix('"'))
                .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
                .unwrap_or(value);
            (!value.is_empty() && !matches!(value, "|" | ">")).then_some(value)
        })
    }
}

/// Splits a note into its front matter (if it opens with a `---` line closed
/// by `---` or `...`) and its body.
pub fn split_front_matter(markdown: &str) -> (Option<FrontMatter<'_>>, &str) {
    let text = markdown.strip_prefix('\u{feff}').unwrap_or(markdown);
    let Some(after_open) = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    else {
        return (None, markdown);
    };
    let mut offset = 0;
    for line in after_open.split_inclusive('\n') {
        let bare = line.trim_end_matches(['\n', '\r']);
        if bare == "---" || bare == "..." {
            let raw = &after_open[..offset];
            let body = &after_open[offset + line.len()..];
            return (Some(FrontMatter { raw }), body);
        }
        offset += line.len();
    }
    (None, markdown)
}

/// A note's title: front matter `title:`, else its first ATX heading, else
/// the file name without its extension.
pub fn title<'a>(markdown: &'a str, file_name: &'a str) -> &'a str {
    let (front, body) = split_front_matter(markdown);
    if let Some(t) = front.as_ref().and_then(|f| f.get("title")) {
        return t;
    }
    let mut in_fence = false;
    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence || line.len() - trimmed.len() >= 4 {
            continue;
        }
        let hashes = trimmed.chars().take_while(|c| *c == '#').count();
        if (1..=6).contains(&hashes) {
            let rest = &trimmed[hashes..];
            if rest.is_empty() || rest.starts_with([' ', '\t']) {
                let heading = rest.trim().trim_end_matches('#').trim_end();
                if !heading.is_empty() {
                    return heading;
                }
            }
        }
    }
    match file_name.rfind('.') {
        Some(dot) if dot > 0 => &file_name[..dot],
        _ => file_name,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_front_matter() {
        let (front, body) = split_front_matter("---\ntitle: Plan\ntags: [a]\n---\n# Heading\n");
        assert_eq!(front.unwrap().raw, "title: Plan\ntags: [a]\n");
        assert_eq!(body, "# Heading\n");

        let (front, body) = split_front_matter("---\r\ntitle: x\r\n...\r\nbody");
        assert_eq!(front.unwrap().get("title"), Some("x"));
        assert_eq!(body, "body");
    }

    #[test]
    fn leaves_notes_without_front_matter_alone() {
        assert_eq!(split_front_matter("# Hi\n---\n"), (None, "# Hi\n---\n"));
        // Opened but never closed: a thematic break, not front matter.
        assert_eq!(
            split_front_matter("---\nnot closed\n"),
            (None, "---\nnot closed\n")
        );
    }

    #[test]
    fn reads_simple_values() {
        let front = FrontMatter {
            raw: "title: \"Quoted: yes\"\nalias: 'one'\nsummary: |\nempty:\n",
        };
        assert_eq!(front.get("title"), Some("Quoted: yes"));
        assert_eq!(front.get("alias"), Some("one"));
        assert_eq!(front.get("summary"), None);
        assert_eq!(front.get("empty"), None);
        assert_eq!(front.get("missing"), None);
    }

    #[test]
    fn titles_a_note() {
        assert_eq!(
            title("---\ntitle: From front\n---\n# Heading", "n.md"),
            "From front"
        );
        assert_eq!(
            title("Intro\n\n## Second level ##\n# First", "n.md"),
            "Second level"
        );
        assert_eq!(
            title(
                "```\n# not a heading\n```\n    # indented code\n#hashtag\n",
                "My note.md"
            ),
            "My note"
        );
        assert_eq!(title("", "README"), "README");
    }
}
