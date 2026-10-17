//! Ordered flow pagination independent of any PDF writer.
//! A page can contain paragraphs and tables, each split at line boundaries.
use super::{
    PaginationError,
    split::{SplitBreakToken, SplitPage, paginate_split_page},
};

const EPS: f32 = 0.001;

/// Header row of a nested table, repeated when continuation starts inside its body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BoxRepeatSpan {
    pub header_item: usize,
    pub end_item: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub enum FlowBlock {
    PageBreak,
    Box {
        item_heights: Vec<f32>,
        padding: f32,
        repeat_headers: Vec<BoxRepeatSpan>,
        keep_together: bool,
        break_before: bool,
    },
    Graphic {
        height: f32,
    },
    Image {
        height: f32,
    },
    Spacer {
        height: f32,
    },
    Paragraph {
        lines: usize,
        line_height: f32,
        padding_before: f32,
        spacing_after: f32,
    },
    Table {
        line_counts: Vec<usize>,
        header_height: f32,
        line_height: f32,
        padding: f32,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum FlowFragment {
    Box {
        block: usize,
        start_item: usize,
        end_item: usize,
        repeat_header: Option<usize>,
        first: bool,
        last: bool,
        height: f32,
    },
    Graphic {
        block: usize,
        height: f32,
    },
    Image {
        block: usize,
        height: f32,
    },
    Spacer {
        block: usize,
        height: f32,
    },
    Paragraph {
        block: usize,
        start_line: usize,
        end_line: usize,
        padding_before: f32,
        height: f32,
    },
    Table {
        block: usize,
        page: SplitPage,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct FlowPage {
    pub fragments: Vec<FlowFragment>,
    pub used_height: f32,
}

/// Paginates sequential blocks inside a fixed content height. The cursor for
/// tables is delegated to the row/line split paginator. No empty pages and no
/// semantic content duplication, with an explicit error on invalid geometry.
pub fn paginate_flow(
    blocks: &[FlowBlock],
    page_height: f32,
) -> Result<Vec<FlowPage>, PaginationError> {
    paginate_flow_with_keep(blocks, &vec![false; blocks.len()], page_height)
}

/// Moves a short text block and the beginning of the next block together when
/// there is enough space on a fresh page. Flags address block indices; only
/// Paragraph and Box blocks may be flagged. Oversized groups degrade to normal flow.
pub fn paginate_flow_with_keep(
    blocks: &[FlowBlock],
    keep_with_next: &[bool],
    page_height: f32,
) -> Result<Vec<FlowPage>, PaginationError> {
    if keep_with_next.len() != blocks.len() {
        return Err(PaginationError::InvalidHeight);
    }
    if !page_height.is_finite() || page_height <= 0.0 {
        return Err(PaginationError::InvalidHeight);
    }
    let mut pages = vec![FlowPage {
        fragments: Vec::new(),
        used_height: 0.0,
    }];
    for (block, item) in blocks.iter().enumerate() {
        if keep_with_next[block] {
            let own_height = match item {
                FlowBlock::Paragraph {
                    lines,
                    line_height,
                    padding_before,
                    spacing_after,
                } => *lines as f32 * line_height + padding_before + spacing_after,
                FlowBlock::Box {
                    item_heights,
                    padding,
                    ..
                } => item_heights.iter().sum::<f32>() + 2.0 * padding,
                _ => return Err(PaginationError::InvalidHeight),
            };
            if let Some(next) = blocks.get(block + 1) {
                let next_height = match next {
                    FlowBlock::PageBreak => page_height,
                    FlowBlock::Box {
                        item_heights,
                        padding,
                        ..
                    } => item_heights.first().copied().unwrap_or(0.0) + 2.0 * padding,
                    FlowBlock::Image { height }
                    | FlowBlock::Graphic { height }
                    | FlowBlock::Spacer { height } => *height,
                    FlowBlock::Paragraph {
                        line_height,
                        padding_before,
                        ..
                    } => line_height + padding_before,
                    FlowBlock::Table {
                        header_height,
                        line_height,
                        padding,
                        ..
                    } => header_height + line_height + 2.0 * padding,
                };
                if own_height.is_finite()
                    && next_height.is_finite()
                    && own_height + next_height <= page_height + EPS
                {
                    let current = pages.last().expect("initial page exists");
                    if current.used_height > 0.0
                        && current.used_height + own_height + next_height > page_height + EPS
                    {
                        pages.push(FlowPage {
                            fragments: Vec::new(),
                            used_height: 0.0,
                        });
                    }
                }
            }
        }
        match item {
            FlowBlock::Box {
                item_heights,
                padding,
                repeat_headers,
                keep_together,
                break_before,
            } => {
                if *break_before && pages.last().is_some_and(|p| !p.fragments.is_empty()) {
                    pages.push(FlowPage {
                        fragments: Vec::new(),
                        used_height: 0.0,
                    });
                }
                if item_heights.is_empty()
                    || item_heights.len() > 10_000
                    || !padding.is_finite()
                    || *padding < 0.0
                    || *padding > 60.0
                    || item_heights.iter().any(|h| {
                        !h.is_finite() || *h <= 0.0 || h + padding * 2.0 > page_height + EPS
                    })
                {
                    return Err(PaginationError::InvalidHeight);
                }
                let mut previous_end = 0;
                for span in repeat_headers {
                    if span.header_item < previous_end
                        || span.end_item > item_heights.len()
                        || span.end_item < span.header_item + 2
                        || item_heights[span.header_item]
                            + item_heights[span.header_item + 1]
                            + 2.0 * padding
                            > page_height + EPS
                    {
                        return Err(PaginationError::InvalidHeight);
                    }
                    previous_end = span.end_item;
                }
                let sum = item_heights.iter().sum::<f32>() + 2.0 * padding;
                if !sum.is_finite() {
                    return Err(PaginationError::InvalidHeight);
                }
                if *keep_together && sum > page_height + EPS {
                    return Err(PaginationError::InvalidHeight);
                }
                let mut cursor = 0;
                while cursor < item_heights.len() {
                    let current = pages.last().expect("page exists");
                    let available = page_height - current.used_height;
                    if current.used_height > 0.0
                        && cursor == 0
                        && sum <= page_height + EPS
                        && sum > available + EPS
                    {
                        pages.push(FlowPage {
                            fragments: Vec::new(),
                            used_height: 0.0,
                        });
                        continue;
                    }
                    // A continued table reserves another measured header row.
                    let continuation = repeat_headers
                        .iter()
                        .find(|span| cursor > span.header_item && cursor < span.end_item);
                    let replay = continuation.map(|span| span.header_item);
                    let header_extra = replay.map(|idx| item_heights[idx]).unwrap_or(0.0);
                    // A new table header must fit with at least its first row.
                    if repeat_headers.iter().any(|span| span.header_item == cursor) {
                        let needed =
                            item_heights[cursor] + item_heights[cursor + 1] + 2.0 * padding;
                        if needed > available + EPS && current.used_height > 0.0 {
                            pages.push(FlowPage {
                                fragments: Vec::new(),
                                used_height: 0.0,
                            });
                            continue;
                        }
                    }
                    let mut end = cursor;
                    let mut consumed = 2.0 * padding + header_extra;
                    while end < item_heights.len()
                        && consumed + item_heights[end] <= available + EPS
                    {
                        consumed += item_heights[end];
                        end += 1;
                    }
                    // Never leave an isolated table header at the page bottom.
                    if repeat_headers
                        .iter()
                        .any(|span| span.header_item >= cursor && span.header_item + 1 == end)
                    {
                        end -= 1;
                        consumed -= item_heights[end];
                    }
                    if end == cursor {
                        if current.fragments.is_empty() {
                            return Err(PaginationError::NoProgress);
                        }
                        pages.push(FlowPage {
                            fragments: Vec::new(),
                            used_height: 0.0,
                        });
                        continue;
                    }
                    let last = end == item_heights.len();
                    let fragment = FlowFragment::Box {
                        block,
                        start_item: cursor,
                        end_item: end,
                        repeat_header: replay,
                        first: cursor == 0,
                        last,
                        height: consumed,
                    };
                    let current = pages.last_mut().expect("page exists");
                    current.used_height += consumed;
                    current.fragments.push(fragment);
                    cursor = end;
                    if !last {
                        pages.push(FlowPage {
                            fragments: Vec::new(),
                            used_height: 0.0,
                        });
                    }
                }
            }
            FlowBlock::PageBreak => {
                if pages.last().is_some_and(|p| !p.fragments.is_empty()) {
                    pages.push(FlowPage {
                        fragments: Vec::new(),
                        used_height: 0.0,
                    });
                }
            }
            FlowBlock::Graphic { height } => {
                if !height.is_finite() || *height <= 0.0 || *height > page_height {
                    return Err(PaginationError::InvalidHeight);
                }
                if pages.last().expect("page exists").used_height + height > page_height + EPS {
                    pages.push(FlowPage {
                        fragments: Vec::new(),
                        used_height: 0.0,
                    });
                }
                let current = pages.last_mut().expect("page exists");
                current.fragments.push(FlowFragment::Graphic {
                    block,
                    height: *height,
                });
                current.used_height += height;
            }
            FlowBlock::Image { height } => {
                if !height.is_finite() || *height <= 0.0 || *height > page_height {
                    return Err(PaginationError::InvalidHeight);
                }
                let current = pages.last_mut().expect("initial page exists");
                if current.used_height + height > page_height + EPS {
                    pages.push(FlowPage {
                        fragments: Vec::new(),
                        used_height: 0.0,
                    });
                }
                let current = pages.last_mut().expect("initial page exists");
                current.fragments.push(FlowFragment::Image {
                    block,
                    height: *height,
                });
                current.used_height += height;
            }
            FlowBlock::Spacer { height } => {
                if !height.is_finite() || *height <= 0.0 || *height > page_height {
                    return Err(PaginationError::InvalidHeight);
                }
                let current = pages.last_mut().expect("initial page exists");
                if current.used_height + height > page_height + EPS {
                    pages.push(FlowPage {
                        fragments: Vec::new(),
                        used_height: 0.0,
                    });
                }
                let current = pages.last_mut().expect("initial page exists");
                current.fragments.push(FlowFragment::Spacer {
                    block,
                    height: *height,
                });
                current.used_height += height;
            }
            FlowBlock::Paragraph {
                lines,
                line_height,
                padding_before,
                spacing_after,
            } => {
                if *lines == 0
                    || !line_height.is_finite()
                    || *line_height <= 0.0
                    || !padding_before.is_finite()
                    || *padding_before < 0.0
                    || !spacing_after.is_finite()
                    || *spacing_after < 0.0
                    || *line_height + padding_before > page_height
                {
                    return Err(PaginationError::InvalidHeight);
                }
                let mut cursor = 0;
                while cursor < *lines {
                    let current = pages.last_mut().expect("initial page exists");
                    let available = page_height - current.used_height;
                    let remainder = *lines - cursor;
                    let whole_height =
                        remainder as f32 * line_height + padding_before + spacing_after;
                    // Preserve a paragraph if it fits fresh, but not in the
                    // remaining page space. Longer paragraphs may fragment.
                    if cursor == 0
                        && current.used_height > 0.0
                        && whole_height <= page_height + EPS
                        && whole_height > available + EPS
                    {
                        pages.push(FlowPage {
                            fragments: Vec::new(),
                            used_height: 0.0,
                        });
                        continue;
                    }
                    let count =
                        ((available - padding_before).max(0.0) / line_height).floor() as usize;
                    if count == 0 {
                        if current.fragments.is_empty() {
                            return Err(PaginationError::NoProgress);
                        }
                        pages.push(FlowPage {
                            fragments: Vec::new(),
                            used_height: 0.0,
                        });
                        continue;
                    }
                    let take = count.min(remainder);
                    let last = cursor + take == *lines;
                    let text_height = take as f32 * line_height;
                    let trailing = if last {
                        spacing_after.min((available - padding_before - text_height).max(0.0))
                    } else {
                        0.0
                    };
                    let height = padding_before + text_height + trailing;
                    current.fragments.push(FlowFragment::Paragraph {
                        block,
                        start_line: cursor,
                        end_line: cursor + take,
                        padding_before: *padding_before,
                        height,
                    });
                    current.used_height += height;
                    cursor += take;
                    if !last {
                        pages.push(FlowPage {
                            fragments: Vec::new(),
                            used_height: 0.0,
                        });
                    }
                }
            }
            FlowBlock::Table {
                line_counts,
                header_height,
                line_height,
                padding,
            } => {
                if !header_height.is_finite()
                    || !line_height.is_finite()
                    || !padding.is_finite()
                    || *header_height < 0.0
                    || *line_height <= 0.0
                    || *padding < 0.0
                    || *header_height + line_height + 2.0 * padding > page_height + EPS
                {
                    return Err(PaginationError::InvalidHeight);
                }
                let mut token: Option<SplitBreakToken> = None;
                loop {
                    let current = pages.last_mut().expect("initial page exists");
                    let available = page_height - current.used_height;
                    // The underlying split pager validates room for at least
                    // one full line even when a table has no data rows.
                    let min_height = *header_height + line_height + 2.0 * padding;
                    if available + EPS < min_height {
                        if current.fragments.is_empty() {
                            return Err(PaginationError::NoProgress);
                        }
                        pages.push(FlowPage {
                            fragments: Vec::new(),
                            used_height: 0.0,
                        });
                        continue;
                    }
                    // Avoid splitting the next row when it fits on a clean
                    // page but not in the currently available space.
                    let row = token.map_or(0, |t| t.row);
                    if current.used_height > 0.0
                        && token.is_none_or(|t| t.line == 0)
                        && row < line_counts.len()
                    {
                        let height =
                            *header_height + line_counts[row] as f32 * line_height + 2.0 * padding;
                        if height <= page_height + EPS && height > available + EPS {
                            pages.push(FlowPage {
                                fragments: Vec::new(),
                                used_height: 0.0,
                            });
                            continue;
                        }
                    }
                    let fragment = paginate_split_page(
                        line_counts,
                        available,
                        *header_height,
                        *line_height,
                        *padding,
                        token,
                    )?;
                    if !line_counts.is_empty() && fragment.slices.is_empty() {
                        return Err(PaginationError::NoProgress);
                    }
                    token = fragment.next;
                    current.used_height += fragment.used_height;
                    current.fragments.push(FlowFragment::Table {
                        block,
                        page: fragment,
                    });
                    if token.is_none() {
                        break;
                    }
                    pages.push(FlowPage {
                        fragments: Vec::new(),
                        used_height: 0.0,
                    });
                }
            }
        }
    }
    if pages.len() > 1 && pages.last().is_some_and(|p| p.fragments.is_empty()) {
        pages.pop();
    }
    Ok(pages)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn para(lines: usize) -> FlowBlock {
        FlowBlock::Paragraph {
            lines,
            line_height: 10.0,
            padding_before: 3.0,
            spacing_after: 4.0,
        }
    }
    fn table(rows: &[usize]) -> FlowBlock {
        FlowBlock::Table {
            line_counts: rows.to_vec(),
            header_height: 12.0,
            line_height: 10.0,
            padding: 2.0,
        }
    }
    #[test]
    fn repeated_box_table_header_is_charged_on_every_continuation_page() {
        let block = FlowBlock::Box {
            item_heights: vec![20.0, 25.0, 25.0, 25.0, 25.0],
            padding: 5.0,
            repeat_headers: vec![BoxRepeatSpan {
                header_item: 0,
                end_item: 5,
            }],
            keep_together: false,
            break_before: false,
        };
        let pages = paginate_flow(&[block], 85.0).unwrap();
        assert_eq!(pages.len(), 2);
        assert!(matches!(
            &pages[0].fragments[0],
            FlowFragment::Box {
                start_item: 0,
                end_item: 3,
                repeat_header: None,
                ..
            }
        ));
        assert!(matches!(&pages[1].fragments[0],
            FlowFragment::Box { start_item:3,end_item:5,repeat_header:Some(0),height,..}
                if (*height-80.0).abs()<0.01));
        assert!(pages.iter().all(|p| p.used_height <= 85.0));
    }
    #[test]
    fn nested_table_header_is_never_orphaned_after_prior_content() {
        let block = FlowBlock::Box {
            item_heights: vec![60.0, 20.0, 20.0, 20.0],
            padding: 5.0,
            repeat_headers: vec![BoxRepeatSpan {
                header_item: 1,
                end_item: 4,
            }],
            keep_together: false,
            break_before: false,
        };
        let pages = paginate_flow(&[block], 100.0).unwrap();
        assert_eq!(pages.len(), 2);
        assert!(matches!(
            &pages[0].fragments[0],
            FlowFragment::Box {
                start_item: 0,
                end_item: 1,
                ..
            }
        ));
        assert!(matches!(
            &pages[1].fragments[0],
            FlowFragment::Box {
                start_item: 1,
                end_item: 4,
                repeat_header: None,
                ..
            }
        ));
    }
    #[test]
    fn box_page_policies_are_explicit_and_preserve_order() {
        let boxed = |keep_together, break_before| FlowBlock::Box {
            item_heights: vec![21.0, 21.0],
            padding: 5.0,
            repeat_headers: vec![],
            keep_together,
            break_before,
        };
        let breaks = paginate_flow(&[para(2), boxed(false, true), para(2)], 100.0).unwrap();
        assert_eq!(breaks.len(), 2);
        assert!(
            breaks[0]
                .fragments
                .iter()
                .all(|f| !matches!(f, FlowFragment::Box { .. }))
        );
        assert!(matches!(
            breaks[1].fragments[0],
            FlowFragment::Box {
                block: 1,
                first: true,
                last: true,
                ..
            }
        ));
        let too_tall = FlowBlock::Box {
            item_heights: vec![45.0, 45.0, 45.0],
            padding: 5.0,
            repeat_headers: vec![],
            keep_together: true,
            break_before: false,
        };
        assert!(paginate_flow(std::slice::from_ref(&too_tall), 100.0).is_err());
        let FlowBlock::Box {
            item_heights,
            padding,
            ..
        } = too_tall
        else {
            unreachable!()
        };
        let splittable = FlowBlock::Box {
            item_heights,
            padding,
            repeat_headers: vec![],
            keep_together: false,
            break_before: false,
        };
        let normal = paginate_flow(&[splittable], 100.0).unwrap();
        assert_eq!(normal.len(), 2);
        let ordered = normal
            .iter()
            .flat_map(|p| p.fragments.iter())
            .flat_map(|f| {
                if let FlowFragment::Box {
                    start_item,
                    end_item,
                    ..
                } = f
                {
                    (*start_item..*end_item).collect::<Vec<_>>()
                } else {
                    Vec::new()
                }
            })
            .collect::<Vec<_>>();
        assert_eq!(ordered, vec![0, 1, 2]);
    }

    #[test]
    fn boxed_keep_with_next_moves_pair_only_when_possible() {
        let blocks = vec![
            para(6),
            FlowBlock::Box {
                item_heights: vec![20.0],
                padding: 5.0,
                repeat_headers: vec![],
                keep_together: true,
                break_before: false,
            },
            para(2),
        ];
        let with_keep = paginate_flow_with_keep(&blocks, &[false, true, false], 100.0).unwrap();
        assert_eq!(with_keep.len(), 2);
        assert!(
            with_keep[0]
                .fragments
                .iter()
                .all(|f| !matches!(f, FlowFragment::Box { .. }))
        );
        assert!(matches!(
            with_keep[1].fragments[0],
            FlowFragment::Box { block: 1, .. }
        ));
        assert!(matches!(
            with_keep[1].fragments[1],
            FlowFragment::Paragraph { block: 2, .. }
        ));
        let without_keep = paginate_flow(&blocks, 100.0).unwrap();
        assert!(
            without_keep[0]
                .fragments
                .iter()
                .any(|f| matches!(f, FlowFragment::Box { block: 1, .. }))
        );
    }

    #[test]
    fn long_box_fragments_without_missing_items_and_edges_only_at_ends() {
        let items = vec![14.0; 70];
        let blocks = vec![
            FlowBlock::Paragraph {
                lines: 2,
                line_height: 12.0,
                padding_before: 3.0,
                spacing_after: 3.0,
            },
            FlowBlock::Box {
                item_heights: items.clone(),
                padding: 9.0,
                repeat_headers: vec![],
                keep_together: false,
                break_before: false,
            },
            FlowBlock::Paragraph {
                lines: 1,
                line_height: 12.0,
                padding_before: 3.0,
                spacing_after: 3.0,
            },
        ];
        let pages = paginate_flow(&blocks, 110.0).unwrap();
        assert!(pages.len() > 3);
        let spans = pages
            .iter()
            .flat_map(|p| p.fragments.iter())
            .filter_map(|f| {
                if let FlowFragment::Box {
                    block: 1,
                    start_item,
                    end_item,
                    first,
                    last,
                    ..
                } = f
                {
                    Some((*start_item, *end_item, *first, *last))
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        assert!(spans.len() > 2);
        assert_eq!(spans.first().unwrap().0, 0);
        assert!(spans.first().unwrap().2);
        assert_eq!(spans.last().unwrap().1, 70);
        assert!(spans.last().unwrap().3);
        assert!(spans.iter().skip(1).all(|s| !s.2));
        assert!(spans.iter().take(spans.len() - 1).all(|s| !s.3));
        let flattened = spans.iter().flat_map(|s| s.0..s.1).collect::<Vec<_>>();
        assert_eq!(flattened, (0..70).collect::<Vec<_>>());
        assert!(
            pages
                .iter()
                .all(|p| p.used_height <= 110.001 && !p.fragments.is_empty())
        );
    }
    #[test]
    fn short_box_is_kept_together_and_oversized_unit_is_rejected() {
        let blocks = vec![
            FlowBlock::Paragraph {
                lines: 5,
                line_height: 14.0,
                padding_before: 5.0,
                spacing_after: 0.0,
            },
            FlowBlock::Box {
                item_heights: vec![24.0, 24.0],
                padding: 12.0,
                repeat_headers: vec![],
                keep_together: false,
                break_before: false,
            },
        ];
        let pages = paginate_flow(&blocks, 110.0).unwrap();
        assert_eq!(pages.len(), 2);
        assert!(pages[1].fragments.iter().any(|f| matches!(
            f,
            FlowFragment::Box {
                first: true,
                last: true,
                ..
            }
        )));
        assert!(
            paginate_flow(
                &[FlowBlock::Box {
                    item_heights: vec![105.0],
                    padding: 5.0,
                    repeat_headers: vec![],
                    keep_together: false,
                    break_before: false,
                }],
                110.0
            )
            .is_err()
        );
    }
    #[test]
    fn mixed_fragments_share_a_page_when_space_remains() {
        let pages = paginate_flow(&[para(2), table(&[1, 1]), para(1)], 120.0).unwrap();
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].fragments.len(), 3);
        assert!(pages[0].used_height <= 120.0);
    }
    #[test]
    fn paragraph_resumes_and_then_table_follows_on_same_page() {
        let pages = paginate_flow(&[para(20), table(&[1]), para(2)], 100.0).unwrap();
        assert!(pages.len() >= 3);
        let spans: Vec<_> = pages
            .iter()
            .flat_map(|p| &p.fragments)
            .filter_map(|f| match f {
                FlowFragment::Paragraph {
                    block: 0,
                    start_line,
                    end_line,
                    ..
                } => Some(*start_line..*end_line),
                _ => None,
            })
            .flatten()
            .collect();
        assert_eq!(spans, (0..20).collect::<Vec<_>>());
        assert!(
            pages
                .iter()
                .all(|p| p.used_height <= 100.001 && !p.fragments.is_empty())
        );
    }
    #[test]
    fn repeated_table_after_long_paragraph_has_no_duplication() {
        let pages = paginate_flow(&[para(12), table(&[1, 100, 3]), para(5)], 90.0).unwrap();
        let parts: Vec<_> = pages
            .iter()
            .flat_map(|p| &p.fragments)
            .filter_map(|f| match f {
                FlowFragment::Table { block: 1, page } => Some(page),
                _ => None,
            })
            .flat_map(|page| &page.slices)
            .flat_map(|slice| (slice.start_line..slice.end_line).map(move |l| (slice.row, l)))
            .collect();
        let expect: Vec<_> = [1, 100, 3]
            .into_iter()
            .enumerate()
            .flat_map(|(r, count)| (0..count).map(move |l| (r, l)))
            .collect();
        assert_eq!(parts, expect);
    }
    #[test]
    fn keeps_short_paragraph_whole_when_room_runs_out() {
        let pages = paginate_flow(&[para(6), para(3)], 80.0).unwrap();
        assert_eq!(pages.len(), 2);
        assert!(matches!(
            &pages[1].fragments[0],
            FlowFragment::Paragraph {
                start_line: 0,
                end_line: 3,
                ..
            }
        ));
    }
    #[test]
    fn empty_document_and_header_only_table() {
        assert_eq!(paginate_flow(&[], 90.0).unwrap().len(), 1);
        let p = paginate_flow(&[table(&[])], 90.0).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].fragments.len(), 1);
    }
    #[test]
    fn image_box_is_atomic_and_moves_to_next_page() {
        let pages = paginate_flow(
            &[
                FlowBlock::Image { height: 60.0 },
                FlowBlock::Image { height: 50.0 },
                FlowBlock::Paragraph {
                    lines: 1,
                    line_height: 10.0,
                    padding_before: 3.0,
                    spacing_after: 4.0,
                },
            ],
            100.0,
        )
        .unwrap();
        assert_eq!(pages.len(), 2);
        assert!(matches!(
            pages[0].fragments[0],
            FlowFragment::Image { block: 0, .. }
        ));
        assert!(matches!(
            pages[1].fragments[0],
            FlowFragment::Image { block: 1, .. }
        ));
        assert_eq!(pages[1].fragments.len(), 2);
        assert!(paginate_flow(&[FlowBlock::Image { height: 110.0 }], 100.0).is_err());
    }
    #[test]
    fn keep_with_next_moves_heading_and_image_together() {
        let blocks = [
            FlowBlock::Spacer { height: 65.0 },
            para(1),
            FlowBlock::Image { height: 40.0 },
        ];
        let without = paginate_flow(&blocks, 100.0).unwrap();
        assert!(matches!(
            without[0].fragments[1],
            FlowFragment::Paragraph { block: 1, .. }
        ));
        let kept = paginate_flow_with_keep(&blocks, &[false, true, false], 100.0).unwrap();
        assert_eq!(kept.len(), 2);
        assert!(matches!(
            kept[1].fragments[0],
            FlowFragment::Paragraph { block: 1, .. }
        ));
        assert!(matches!(
            kept[1].fragments[1],
            FlowFragment::Image { block: 2, .. }
        ));
        assert!(kept.iter().all(|p| p.used_height <= 100.01));
    }
    #[test]
    fn keep_with_next_table_uses_first_row_as_minimum() {
        let blocks = [
            FlowBlock::Spacer { height: 62.0 },
            para(1),
            table(&[1, 1, 1, 1, 1, 1]),
        ];
        let kept = paginate_flow_with_keep(&blocks, &[false, true, false], 100.0).unwrap();
        assert!(matches!(
            kept[1].fragments[0],
            FlowFragment::Paragraph { block: 1, .. }
        ));
        assert!(matches!(
            kept[1].fragments[1],
            FlowFragment::Table { block: 2, .. }
        ));
        assert!(paginate_flow_with_keep(&blocks, &[false], 100.0).is_err());
        assert!(paginate_flow_with_keep(&blocks, &[true, false, false], 100.0).is_err());
    }
    #[test]
    fn keep_with_next_gracefully_degrades_when_group_exceeds_page() {
        let blocks = [
            FlowBlock::Spacer { height: 50.0 },
            para(4),
            FlowBlock::Image { height: 75.0 },
        ];
        let pages = paginate_flow_with_keep(&blocks, &[false, true, false], 100.0).unwrap();
        assert!(pages.len() >= 2);
        assert_eq!(
            pages
                .iter()
                .map(|p| p
                    .fragments
                    .iter()
                    .filter(|f| matches!(f, FlowFragment::Image { .. }))
                    .count())
                .sum::<usize>(),
            1
        );
    }
    #[test]
    fn graphics_are_atomic() {
        let blocks = [
            FlowBlock::Graphic { height: 70.0 },
            FlowBlock::Graphic { height: 40.0 },
        ];
        let pages = paginate_flow(&blocks, 100.0).unwrap();
        assert_eq!(pages.len(), 2);
        assert!(matches!(
            pages[1].fragments[0],
            FlowFragment::Graphic {
                block: 1,
                height: 40.0
            }
        ));
        assert!(paginate_flow(&[FlowBlock::Graphic { height: 110.0 }], 100.0).is_err());
    }
    #[test]
    fn explicit_break_starts_next_page_without_trailing_blank() {
        let pages = paginate_flow(
            &[
                FlowBlock::Paragraph {
                    lines: 1,
                    line_height: 12.0,
                    padding_before: 5.0,
                    spacing_after: 5.0,
                },
                FlowBlock::PageBreak,
                FlowBlock::PageBreak,
                FlowBlock::Paragraph {
                    lines: 1,
                    line_height: 12.0,
                    padding_before: 5.0,
                    spacing_after: 5.0,
                },
                FlowBlock::PageBreak,
            ],
            100.0,
        )
        .unwrap();
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[0].fragments.len(), 1);
        assert_eq!(pages[1].fragments.len(), 1);
        assert!(matches!(
            pages[1].fragments[0],
            FlowFragment::Paragraph { block: 3, .. }
        ));
    }
    #[test]
    fn spacer_moves_to_next_page_and_does_not_draw() {
        let pages = paginate_flow(
            &[para(4), FlowBlock::Spacer { height: 45.0 }, para(1)],
            80.0,
        )
        .unwrap();
        assert_eq!(pages.len(), 2);
        assert!(matches!(
            pages[1].fragments[0],
            FlowFragment::Spacer {
                block: 1,
                height: 45.0
            }
        ));
        assert!(pages.iter().all(|p| p.used_height <= 80.0));
        assert!(paginate_flow(&[FlowBlock::Spacer { height: f32::NAN }], 80.0).is_err());
    }
    #[test]
    fn rejects_unrenderable_geometry() {
        assert!(paginate_flow(&[para(1)], f32::NAN).is_err());
        assert!(paginate_flow(&[para(0)], 90.0).is_err());
        assert!(paginate_flow(&[table(&[1])], 10.0).is_err());
    }
}
