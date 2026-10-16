//! Resumable pagination spike (indivisible table rows).
pub mod flow;
pub mod split;
use std::fmt;
use vufra_core::TableRow;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BreakToken {
    pub next_row: usize,
}
#[derive(Clone, Debug, PartialEq)]
pub struct PageFragment {
    pub start_row: usize,
    pub end_row: usize,
    pub used_height: f32,
    pub next: Option<BreakToken>,
}
#[derive(Clone, Debug, PartialEq)]
pub enum PaginationError {
    InvalidHeight,
    InvalidRow {
        row: usize,
    },
    RowTooTall {
        row: usize,
        height: f32,
        capacity: f32,
    },
    InvalidToken,
    NoProgress,
}
impl fmt::Display for PaginationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for PaginationError {}

/// Layout one page. Heights are in points. The repeated header consumes page space.
pub fn paginate_page(
    rows: &[TableRow],
    height: f32,
    repeated_header: f32,
    token: Option<BreakToken>,
) -> Result<PageFragment, PaginationError> {
    if !height.is_finite()
        || !repeated_header.is_finite()
        || height <= 0.0
        || repeated_header < 0.0
        || repeated_header >= height
    {
        return Err(PaginationError::InvalidHeight);
    }
    let start = token.map_or(0, |t| t.next_row);
    if start > rows.len() {
        return Err(PaginationError::InvalidToken);
    }
    let capacity = height - repeated_header;
    if start == rows.len() {
        return Ok(PageFragment {
            start_row: start,
            end_row: start,
            used_height: 0.0,
            next: None,
        });
    }
    let mut used = repeated_header;
    let mut cursor = start;
    for (idx, row) in rows.iter().enumerate().skip(start) {
        if !row.height.is_finite() || row.height <= 0.0 {
            return Err(PaginationError::InvalidRow { row: idx });
        }
        if row.height > capacity {
            return Err(PaginationError::RowTooTall {
                row: idx,
                height: row.height,
                capacity,
            });
        }
        if used + row.height > height {
            break;
        }
        used += row.height;
        cursor += 1;
    }
    if cursor == start {
        return Err(PaginationError::NoProgress);
    }
    Ok(PageFragment {
        start_row: start,
        end_row: cursor,
        used_height: used,
        next: (cursor < rows.len()).then_some(BreakToken { next_row: cursor }),
    })
}
/// Continue until all rows have been allocated or return an explicit failure.
pub fn paginate_all(
    rows: &[TableRow],
    height: f32,
    repeated_header: f32,
) -> Result<Vec<PageFragment>, PaginationError> {
    if rows.is_empty() {
        return Ok(vec![paginate_page(rows, height, repeated_header, None)?]);
    }
    let mut pages = Vec::new();
    let mut token = None;
    loop {
        let page = paginate_page(rows, height, repeated_header, token)?;
        token = page.next;
        pages.push(page);
        if token.is_none() {
            return Ok(pages);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn rows(count: usize, height: f32) -> Vec<TableRow> {
        (0..count)
            .map(|i| TableRow::new(format!("row {i}"), height))
            .collect()
    }
    #[test]
    fn thousand_rows_exactly_once() {
        let pages = paginate_all(&rows(1000, 19.0), 700.0, 24.0).unwrap();
        assert!(pages.len() > 1);
        let indexes: Vec<_> = pages.iter().flat_map(|p| p.start_row..p.end_row).collect();
        assert_eq!(indexes, (0..1000).collect::<Vec<_>>());
        assert!(pages.iter().all(|p| p.used_height <= 700.0));
        assert_eq!(pages.last().unwrap().next, None);
    }
    #[test]
    fn too_tall_row_is_error() {
        assert!(matches!(
            paginate_all(&rows(1, 900.0), 700.0, 25.0),
            Err(PaginationError::RowTooTall { row: 0, .. })
        ));
    }
    #[test]
    fn invalid_height_and_nan() {
        assert_eq!(
            paginate_all(&rows(1, f32::NAN), 700.0, 20.0),
            Err(PaginationError::InvalidRow { row: 0 })
        );
        assert_eq!(
            paginate_all(&rows(1, 10.0), f32::NAN, 20.0),
            Err(PaginationError::InvalidHeight)
        );
    }
    #[test]
    fn empty_rows() {
        let p = paginate_all(&[], 700.0, 24.0).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].used_height, 0.0);
    }
    #[test]
    fn resume_at_end_is_empty() {
        let p = paginate_page(
            &rows(3, 10.0),
            100.0,
            10.0,
            Some(BreakToken { next_row: 3 }),
        )
        .unwrap();
        assert_eq!(p.used_height, 0.0);
        assert_eq!(p.next, None);
    }
    #[test]
    fn bad_token() {
        assert_eq!(
            paginate_page(
                &rows(3, 10.0),
                100.0,
                10.0,
                Some(BreakToken { next_row: 4 })
            ),
            Err(PaginationError::InvalidToken)
        );
    }
}
