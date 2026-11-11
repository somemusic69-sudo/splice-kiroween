use regex::{Regex, RegexBuilder};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::LazyLock;
use wasm_bindgen::prelude::*;

const MAX_BYTES: usize = 2 * 1024 * 1024;
const EXCERPT_LIMIT: usize = 16_000;
static PLAIN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:(?:\d{4}-\d{2}-\d{2}\S*|\d\d:\d\d:\d\d)\s+)?\[?(fatal|error|warn(?:ing)?|info|debug|trace)\]?[\s:]+(.*)$").unwrap()
});

#[derive(Serialize)]
struct Group<'a> {
    level: &'a str,
    message: String,
    sample: &'a str,
    count: usize,
}

#[derive(Serialize)]
struct Report<'a> {
    total: usize,
    matched: usize,
    groups: Vec<Group<'a>>,
    excerpt: String,
}

fn severity(value: &str) -> &'static str {
    match value.to_ascii_uppercase().as_str() {
        "FATAL" | "ERROR" => "ERROR",
        "WARNING" | "WARN" => "WARN",
        "INFO" => "INFO",
        "DEBUG" => "DEBUG",
        "TRACE" => "TRACE",
        _ => "UNKNOWN",
    }
}

fn parse(line: &str) -> (&'static str, String) {
    if let Ok(Value::Object(fields)) = serde_json::from_str::<Value>(line) {
        let level = fields.get("level").or_else(|| fields.get("severity"));
        let message = fields.get("message").or_else(|| fields.get("msg"));
        return (
            severity(level.and_then(Value::as_str).unwrap_or_default()),
            message.and_then(Value::as_str).unwrap_or(line).to_owned(),
        );
    }
    if let Some(parts) = PLAIN.captures(line.trim_start()) {
        return (severity(&parts[1]), parts[2].to_owned());
    }
    ("UNKNOWN", line.to_owned())
}

fn limited(value: &str, max: usize) -> &str {
    let mut end = value.len().min(max);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

fn report<'a>(raw: &'a str, level: &str, pattern: &str) -> Result<Report<'a>, String> {
    if raw.len() > MAX_BYTES {
        return Err("Logs must be 2 MiB or smaller.".into());
    }
    let regex = RegexBuilder::new(pattern)
        .size_limit(1024 * 1024)
        .build()
        .map_err(|error| format!("Invalid regex: {error}"))?;
    let mut groups = HashMap::new();
    let mut total = 0;
    let mut matched = 0;
    let mut excerpt = String::new();

    for line in raw.lines().filter(|line| !line.trim().is_empty()) {
        total += 1;
        let (line_level, message) = parse(line);
        if (!level.is_empty() && level != line_level) || !regex.is_match(line) {
            continue;
        }
        matched += 1;
        if excerpt.len() + line.len() < EXCERPT_LIMIT {
            excerpt.push_str(line);
            excerpt.push('\n');
        } else if excerpt.is_empty() {
            excerpt.push_str(limited(line, EXCERPT_LIMIT));
        }
        let entry = groups.entry((line_level, message));
        let (_, count) = entry.or_insert((line, 0));
        *count += 1;
    }
    let mut groups: Vec<_> = groups.into_iter().collect();
    groups.sort_unstable_by(|a, b| b.1.1.cmp(&a.1.1).then_with(|| a.0.cmp(&b.0)));
    let groups = groups
        .into_iter()
        .take(200)
        .map(|((level, message), (sample, count))| Group {
            level,
            message: limited(&message, 1024).to_owned(),
            sample: limited(sample, EXCERPT_LIMIT),
            count,
        })
        .collect();
    Ok(Report { total, matched, groups, excerpt })
}

#[wasm_bindgen]
pub fn analyze(raw: &str, level: &str, pattern: &str) -> String {
    match report(raw, level, pattern) {
        Ok(result) => serde_json::to_string(&result).unwrap(),
        Err(error) => serde_json::json!({ "error": error }).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_json_and_plain_lines_by_level_and_message() {
        let result = report(
            "{\"level\":\"error\",\"msg\":\"retry too soon\"}\n2026-11-11T00:00:00Z ERROR retry too soon\nINFO ok",
            "ERROR",
            "retry",
        ).unwrap();
        assert_eq!((result.total, result.matched, result.groups.len()), (3, 2, 1));
        assert_eq!(result.groups[0].count, 2);
        assert!(result.excerpt.contains("2026-11-11"));
    }

    #[test]
    fn rejects_invalid_regex() {
        assert!(report("INFO ok", "", "[").is_err());
    }
}
