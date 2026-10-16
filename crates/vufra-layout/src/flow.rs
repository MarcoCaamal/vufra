//! Ordered flow pagination independent of any PDF writer.
//! A page can contain paragraphs and tables, each split at line boundaries.
use super::{
    PaginationError,
    split::{SplitBreakToken, SplitPage, paginate_split_page},
};

const EPS: f32 = 0.001;

#[derive(Debug, Clone, PartialEq)]
pub enum FlowBlock {
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
/// Paragraph blocks may be flagged. Oversized groups degrade to normal flow.
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
            let FlowBlock::Paragraph {
                lines,
                line_height,
                padding_before,
                spacing_after,
            } = item
            else {
                return Err(PaginationError::InvalidHeight);
            };
            if let Some(next) = blocks.get(block + 1) {
                let own_height = *lines as f32 * line_height + padding_before + spacing_after;
                let next_height = match next {
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
