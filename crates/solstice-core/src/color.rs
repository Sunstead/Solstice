//! Workspace colors: a vault's color on the server, a folder's in its
//! `.solstice/workspace.json`. Mirrors `normalizeHex` in the desktop app's
//! `lib/workspace/color.ts`; the tests there and here cover the same cases.

/// `#rgb` or `#rrggbb`, any case, as lowercase `#rrggbb`; anything else is
/// not a color.
pub fn normalize_hex(input: &str) -> Option<String> {
    let hex = input.trim().strip_prefix('#')?;
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let full: String = match hex.len() {
        3 => hex.chars().flat_map(|c| [c, c]).collect(),
        6 => hex.to_owned(),
        _ => return None,
    };
    Some(format!("#{}", full.to_ascii_lowercase()))
}

#[cfg(test)]
mod tests {
    use super::normalize_hex;

    #[test]
    fn accepts_short_and_long_hex_in_any_case() {
        assert_eq!(normalize_hex("#4F7CC4").as_deref(), Some("#4f7cc4"));
        assert_eq!(normalize_hex("  #abc ").as_deref(), Some("#aabbcc"));
        assert_eq!(normalize_hex("#FFF").as_deref(), Some("#ffffff"));
    }

    #[test]
    fn rejects_everything_else() {
        for bad in ["", "#", "4f7cc4", "#fffff", "#ggg", "#12345678", "red", "#ab c"] {
            assert_eq!(normalize_hex(bad), None, "{bad:?}");
        }
    }
}
