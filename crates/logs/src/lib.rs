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

#[cfg(test)]
mod properties {
    use super::*;
    use proptest::prelude::*;
    use serde_json::json;

    const LEVELS: [&str; 6] = ["ERROR", "WARN", "INFO", "DEBUG", "TRACE", "UNKNOWN"];
    // Valid patterns, so the filter path (not the rejection path) is exercised.
    const PATTERNS: [&str; 7] = ["", "retry", "(?i)error", r"^\d", "a|b", ".", "^$"];

    fn message() -> impl Strategy<Value = String> {
        prop_oneof![
            prop::sample::select(vec!["retry too soon", "timeout", "ok", "a", "b"]).prop_map(String::from),
            "[^\r\n]{0,24}",
        ]
    }

    fn line() -> impl Strategy<Value = String> {
        let word = prop::sample::select(vec![
            "error", "ERROR", "Fatal", "warn", "WARNING", "info", "Debug", "trace", "bogus",
        ]);
        let plain = (
            prop::option::of(prop::sample::select(vec!["2026-11-11T00:00:00Z", "2026-11-11", "12:34:56"])),
            word.clone(),
            prop::sample::select(vec![" ", ": ", "] ", "  "]),
            prop::bool::ANY,
            message(),
        )
            .prop_map(|(time, word, sep, bracket, msg)| {
                let stamp = time.map(|t| format!("{t} ")).unwrap_or_default();
                let word = if bracket { format!("[{word}") } else { word.to_string() };
                format!("{stamp}{word}{sep}{msg}")
            });
        let structured = (
            prop::sample::select(vec!["level", "severity", "other"]),
            word,
            prop::sample::select(vec!["message", "msg", "other"]),
            message(),
        )
            .prop_map(|(lk, lv, mk, msg)| json!({ lk: lv, mk: msg }).to_string());
        prop_oneof![plain, structured, "[^\r\n]{0,40}", Just(String::new()), Just("   ".to_string())]
    }

    fn input() -> impl Strategy<Value = String> {
        prop::collection::vec(line(), 0..40).prop_map(|lines| lines.join("\n"))
    }

    fn filter() -> impl Strategy<Value = (&'static str, &'static str)> {
        (
            prop::sample::select(vec!["", "ERROR", "WARN", "INFO", "DEBUG", "TRACE", "UNKNOWN", "error", "NOPE"]),
            prop::sample::select(PATTERNS.to_vec()),
        )
    }

    proptest! {
        // analyze() never panics and always returns JSON, for any text, level and pattern.
        #[test]
        fn analyze_never_panics_and_returns_json(raw in "\\PC{0,400}", level in "\\PC{0,8}", pattern in "\\PC{0,24}") {
            let out = analyze(&raw, &level, &pattern);
            let value: Value = serde_json::from_str(&out).unwrap();
            prop_assert!(value.get("error").is_some() || value.get("matched").is_some());
        }

        // parse() never panics and always yields a known severity.
        #[test]
        fn parse_yields_known_level(raw in "\\PC{0,200}") {
            let (level, _) = parse(&raw);
            prop_assert!(LEVELS.contains(&level));
        }

        // limited() returns a prefix of at most `max` bytes cut on a char boundary.
        #[test]
        fn limited_is_bounded_prefix(text in "\\PC{0,64}", max in 0usize..80) {
            let cut = limited(&text, max);
            prop_assert!(cut.len() <= max);
            prop_assert!(text.starts_with(cut));
            prop_assert!(cut.len() == text.len() || cut.len() + 4 > max.min(text.len()));
        }

        // total counts exactly the non-blank lines, and matched never exceeds it.
        #[test]
        fn total_counts_non_blank_lines((raw, (level, pattern)) in (input(), filter())) {
            let result = report(&raw, level, pattern).unwrap();
            let non_blank = raw.lines().filter(|l| !l.trim().is_empty()).count();
            prop_assert_eq!(result.total, non_blank);
            prop_assert!(result.matched <= result.total);
        }

        // Group counts sum to the matched lines (inputs here have far fewer than 200 groups).
        #[test]
        fn group_counts_sum_to_matched((raw, (level, pattern)) in (input(), filter())) {
            let result = report(&raw, level, pattern).unwrap();
            prop_assert_eq!(result.groups.iter().map(|g| g.count).sum::<usize>(), result.matched);
            prop_assert!(result.groups.iter().all(|g| g.count >= 1));
        }

        // Even with many distinct messages, output is capped and counts never exceed matched.
        #[test]
        fn group_list_is_capped(lines in prop::collection::vec("[a-z]{1,6}", 0..600)) {
            let raw = lines.iter().map(|m| format!("ERROR {m}")).collect::<Vec<_>>().join("\n");
            let result = report(&raw, "", "").unwrap();
            prop_assert!(result.groups.len() <= 200);
            prop_assert!(result.groups.iter().map(|g| g.count).sum::<usize>() <= result.matched);
            prop_assert_eq!(result.matched, lines.len());
        }

        // Every group satisfies the level and regex filters, and its sample is a real input line.
        #[test]
        fn every_group_satisfies_filters((raw, (level, pattern)) in (input(), filter())) {
            let result = report(&raw, level, pattern).unwrap();
            let regex = Regex::new(pattern).unwrap();
            let lines: Vec<&str> = raw.lines().collect();
            for group in &result.groups {
                if !level.is_empty() {
                    prop_assert_eq!(group.level, level);
                }
                prop_assert!(regex.is_match(group.sample));
                prop_assert!(lines.contains(&group.sample));
                let (sample_level, sample_message) = parse(group.sample);
                prop_assert_eq!(group.level, sample_level);
                prop_assert!(sample_message.starts_with(&group.message));
            }
        }

        // The excerpt is a subset of the input: only matching input lines, never more than the limit.
        #[test]
        fn excerpt_is_subset_of_matching_input((raw, (level, pattern)) in (input(), filter())) {
            let result = report(&raw, level, pattern).unwrap();
            let regex = Regex::new(pattern).unwrap();
            let lines: Vec<&str> = raw.lines().collect();
            prop_assert!(result.excerpt.len() <= EXCERPT_LIMIT);
            let excerpt: Vec<&str> = result.excerpt.lines().collect();
            prop_assert!(excerpt.len() <= result.matched);
            for kept in excerpt {
                prop_assert!(lines.contains(&kept));
                prop_assert!(regex.is_match(kept));
                prop_assert!(level.is_empty() || parse(kept).0 == level);
            }
        }

        // No filter keeps everything; the per-level filters partition the unfiltered match set.
        #[test]
        fn level_filters_partition_matches((raw, (_, pattern)) in (input(), filter())) {
            let all = report(&raw, "", pattern).unwrap();
            let by_level: usize = LEVELS.iter().map(|l| report(&raw, l, pattern).unwrap().matched).sum();
            prop_assert_eq!(by_level, all.matched);
            prop_assert_eq!(report(&raw, "", "").unwrap().matched, all.total);
        }

        // Adding a filter can only shrink the result.
        #[test]
        fn filtering_never_adds_matches((raw, (level, pattern)) in (input(), filter())) {
            let unfiltered = report(&raw, "", "").unwrap();
            let filtered = report(&raw, level, pattern).unwrap();
            prop_assert_eq!(filtered.total, unfiltered.total);
            prop_assert!(filtered.matched <= unfiltered.matched);
        }

        // Groups are sorted by count descending, and the same input always gives the same output.
        #[test]
        fn groups_sorted_and_output_deterministic((raw, (level, pattern)) in (input(), filter())) {
            let result = report(&raw, level, pattern).unwrap();
            prop_assert!(result.groups.windows(2).all(|w| w[0].count >= w[1].count));
            prop_assert_eq!(analyze(&raw, level, pattern), analyze(&raw, level, pattern));
        }

        // Invalid regexes are rejected with an error and never produce a report.
        #[test]
        fn invalid_regex_is_rejected(raw in input(), tail in "[a-z]{0,6}", opener in prop::sample::select(vec!["(", "[", "*", "a{2,1}", r"\"])) {
            let pattern = format!("{opener}{tail}");
            // `*` / `\` forms are only invalid with an empty tail; skip the combinations that can parse.
            prop_assume!(Regex::new(&pattern).is_err());
            prop_assert!(report(&raw, "", &pattern).is_err());
            let value: Value = serde_json::from_str(&analyze(&raw, "", &pattern)).unwrap();
            prop_assert!(value["error"].as_str().unwrap().starts_with("Invalid regex"));
            prop_assert!(value.get("matched").is_none());
        }
    }

    // Input over 2 MiB is rejected before any parsing happens.
    #[test]
    fn oversized_input_is_rejected() {
        let raw = "x".repeat(MAX_BYTES + 1);
        assert!(report(&raw, "", "").is_err());
        assert!(report(&raw[..MAX_BYTES], "", "").is_ok());
    }
}
