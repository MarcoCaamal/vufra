//! Line-granular table pagination. Unlike `paginate_all`, a row can
//! continue across pages while preserving the same line offset for all cells.
//! Row fragments are an internal layout detail, not repeated semantic rows.

use super::PaginationError;

/// Cursor points to the next unrendered line of a row.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SplitBreakToken {
    pub row: usize,
    pub line: usize,
}

/// A vertical slice shared by ALL columns in a row.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RowSlice {
    pub row: usize,
    pub start_line: usize,
    pub end_line: usize,
    pub first: bool,
    pub last: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SplitPage {
    pub slices: Vec<RowSlice>,
    pub used_height: f32,
    pub next: Option<SplitBreakToken>,
}

/// One page, with header space reserved each time. All rows must have at least
/// one line (empty cells still consume one line). Continuation offsets are
/// shared across columns; short cells simply leave blanks after their last line.
pub fn paginate_split_page(
    line_counts: &[usize],
    page_height: f32,
    header_height: f32,
    line_height: f32,
    vertical_padding: f32,
    token: Option<SplitBreakToken>,
) -> Result<SplitPage, PaginationError> {
    if !page_height.is_finite()
        || !header_height.is_finite()
        || !line_height.is_finite()
        || !vertical_padding.is_finite()
        || page_height <= 0.0
        || header_height < 0.0
        || header_height >= page_height
        || line_height <= 0.0
        || vertical_padding < 0.0
        || header_height + line_height + vertical_padding * 2.0 > page_height
    {
        return Err(PaginationError::InvalidHeight);
    }
    let mut row = token.map_or(0, |cursor| cursor.row);
    let mut line = token.map_or(0, |cursor| cursor.line);
    if row < line_counts.len() && line_counts[row] == 0 {
        return Err(PaginationError::InvalidRow { row });
    }
    if row > line_counts.len()
        || (row == line_counts.len() && line != 0)
        || (row < line_counts.len() && line >= line_counts[row])
    {
        return Err(PaginationError::InvalidToken);
    }
    let capacity = page_height - header_height;
    let mut used = header_height;
    let mut slices = Vec::new();
    const EPS: f32 = 0.001;

    while row < line_counts.len() {
        let count = line_counts[row];
        if count == 0 {
            return Err(PaginationError::InvalidRow { row });
        }
        let remaining_height = page_height - used;
        let first = line == 0;
        let top = if first { vertical_padding } else { 0.0 };
        let remaining_lines = count - line;
        let total_height = remaining_lines as f32 * line_height + top + vertical_padding;

        // Keep a row together whenever it can fit on a fresh page, preventing
        // an unnecessary split just because earlier rows filled this page.
        if first
            && total_height <= capacity + EPS
            && total_height > remaining_height + EPS
            && !slices.is_empty()
        {
            break;
        }

        let available_for_lines = remaining_height - top;
        if available_for_lines + EPS < line_height {
            if slices.is_empty() {
                return Err(PaginationError::NoProgress);
            }
            break;
        }
        let max_lines = ((available_for_lines + EPS) / line_height).floor() as usize;
        let mut take = remaining_lines.min(max_lines);
        let mut last = take == remaining_lines;

        // Reserve the bottom padding only in the final fragment. If the final
        // line fits but the bottom padding does not, move that line to the next
        // page rather than producing a border-only continuation fragment.
        if last && top + take as f32 * line_height + vertical_padding > remaining_height + EPS {
            take = take.saturating_sub(1);
            last = false;
        }
        if take == 0 {
            if slices.is_empty() {
                return Err(PaginationError::NoProgress);
            }
            break;
        }
        let fragment_height =
            top + take as f32 * line_height + if last { vertical_padding } else { 0.0 };
        used += fragment_height;
        slices.push(RowSlice {
            row,
            start_line: line,
            end_line: line + take,
            first,
            last,
        });
        if last {
            row += 1;
            line = 0;
        } else {
            line += take;
        }
    }

    let next = if row < line_counts.len() {
        Some(SplitBreakToken { row, line })
    } else {
        None
    };
    Ok(SplitPage {
        slices,
        used_height: used,
        next,
    })
}

pub fn paginate_split_all(
    line_counts: &[usize],
    page_height: f32,
    header_height: f32,
    line_height: f32,
    vertical_padding: f32,
) -> Result<Vec<SplitPage>, PaginationError> {
    // Validation applies even to empty documents.
    let mut pages = Vec::new();
    let mut next = None;
    loop {
        let page = paginate_split_page(
            line_counts,
            page_height,
            header_height,
            line_height,
            vertical_padding,
            next,
        )?;
        next = page.next;
        pages.push(page);
        if next.is_none() {
            return Ok(pages);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pages(rows: &[usize], page: f32, header: f32) -> Vec<SplitPage> {
        paginate_split_all(rows, page, header, 10.0, 3.0).unwrap()
    }

    #[test]
    fn oversized_row_resumes_without_loss() {
        let result = pages(&[99], 60.0, 10.0);
        assert!(result.len() > 10);
        let indexes: Vec<_> = result
            .iter()
            .flat_map(|p| p.slices.iter())
            .flat_map(|s| s.start_line..s.end_line)
            .collect();
        assert_eq!(indexes, (0..99).collect::<Vec<_>>());
        assert!(result.iter().all(|p| p.used_height <= 60.001));
        assert!(result.iter().all(|p| !p.slices.is_empty()));
        assert!(result[0].slices[0].first);
        assert!(!result[0].slices[0].last);
        assert!(result.last().unwrap().slices.last().unwrap().last);
    }

    #[test]
    fn common_rows_do_not_split_when_they_fit_on_next_page() {
        let result = pages(&[2, 2, 2], 70.0, 10.0);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].slices.len(), 2);
        assert!(
            result
                .iter()
                .flat_map(|p| &p.slices)
                .all(|s| s.first && s.last)
        );
    }

    #[test]
    fn progress_with_mixed_rows_and_long_middle_row() {
        let result = pages(&[1, 100, 2, 1], 60.0, 10.0);
        let mut segments = Vec::new();
        for page in &result {
            for s in &page.slices {
                segments.extend((s.start_line..s.end_line).map(|line| (s.row, line)));
            }
        }
        let expected: Vec<_> = [1, 100, 2, 1]
            .iter()
            .enumerate()
            .flat_map(|(r, &n)| (0..n).map(move |l| (r, l)))
            .collect();
        assert_eq!(segments, expected);
    }

    #[test]
    fn exact_capacity_and_one_line_row() {
        let result = pages(&[4, 1], 56.0, 10.0);
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|p| p.used_height <= 56.001));
    }

    #[test]
    fn empty_table_and_end_token() {
        let result = pages(&[], 60.0, 10.0);
        assert_eq!(result.len(), 1);
        assert!(result[0].slices.is_empty());
        assert_eq!(result[0].next, None);
        let end = paginate_split_page(
            &[2],
            60.0,
            10.0,
            10.0,
            3.0,
            Some(SplitBreakToken { row: 1, line: 0 }),
        )
        .unwrap();
        assert!(end.slices.is_empty());
    }

    #[test]
    fn invalid_tokens_and_geometry_rejected() {
        let values = &[2];
        assert_eq!(
            paginate_split_page(
                values,
                60.0,
                10.0,
                10.0,
                3.0,
                Some(SplitBreakToken { row: 0, line: 2 })
            ),
            Err(PaginationError::InvalidToken)
        );
        assert_eq!(
            paginate_split_page(
                values,
                60.0,
                10.0,
                10.0,
                3.0,
                Some(SplitBreakToken { row: 2, line: 0 })
            ),
            Err(PaginationError::InvalidToken)
        );
        assert_eq!(
            paginate_split_all(&[0], 60.0, 10.0, 10.0, 3.0),
            Err(PaginationError::InvalidRow { row: 0 })
        );
        assert_eq!(
            paginate_split_all(&[1], 12.0, 10.0, 10.0, 3.0),
            Err(PaginationError::InvalidHeight)
        );
        assert_eq!(
            paginate_split_all(&[1], 60.0, f32::NAN, 10.0, 3.0),
            Err(PaginationError::InvalidHeight)
        );
    }

    #[test]
    fn deterministic_stress_preserves_every_line_and_page_bounds() {
        let counts = (0..350)
            .map(|i| {
                // Mix short, exact-ish and very long rows without randomness.
                ((i * 37 + 13) % 125) + 1
            })
            .collect::<Vec<_>>();
        let pages = paginate_split_all(&counts, 650.0, 28.0, 16.0, 6.0).unwrap();
        assert!(pages.len() > 10);
        assert!(
            pages
                .iter()
                .all(|p| p.used_height <= 650.001 && !p.slices.is_empty())
        );
        let observed = pages
            .iter()
            .flat_map(|p| p.slices.iter())
            .flat_map(|slice| (slice.start_line..slice.end_line).map(move |line| (slice.row, line)))
            .collect::<Vec<_>>();
        let expected = counts
            .iter()
            .enumerate()
            .flat_map(|(row, &count)| (0..count).map(move |line| (row, line)))
            .collect::<Vec<_>>();
        assert_eq!(observed, expected);
        assert_eq!(pages.last().unwrap().next, None);
    }

    #[test]
    fn token_resume_matches_full_run() {
        let counts = &[1, 75, 5, 19];
        let full = pages(counts, 75.0, 14.0);
        let mut cursor = None;
        let mut from_resume = Vec::new();
        loop {
            let page = paginate_split_page(counts, 75.0, 14.0, 10.0, 3.0, cursor).unwrap();
            cursor = page.next;
            from_resume.push(page);
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(full, from_resume);
    }
}
