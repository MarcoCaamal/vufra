//! Ordered flow pagination independent of any PDF writer.
//! Pages contain recursive boxes, text, images and spacers.
use super::PaginationError;

const EPS: f32 = 0.001;

/// Inclusive-exclusive range of leaves inside a nested decorated container.
/// Each occupied page fragment reserves its own top and bottom padding.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BoxNestedSpan {
    pub start_item: usize,
    pub end_item: usize,
    pub padding: f32,
    /// True prevents splitting a child box even when the parent can split.
    pub keep_together: bool,
    pub break_before: bool,
}

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
        nested_spans: Vec<BoxNestedSpan>,
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

/// The first visible fragment's minimum footprint. A hard page break (or
/// an explicit break-before box) must never be crossed by keep-with-next.
fn first_visible_height(block: &FlowBlock, page_height: f32) -> Option<f32> {
    match block {
        FlowBlock::PageBreak | FlowBlock::Spacer { .. } => None,
        FlowBlock::Box {
            break_before: true, ..
        } => None,
        FlowBlock::Box {
            item_heights,
            padding,
            repeat_headers,
            nested_spans,
            ..
        } => {
            // A box that fits on an empty page is moved there *whole* by the
            // box paginator. Keep-next must reserve its whole size as well;
            // otherwise a heading may fit while the box jumps to the next page.
            let total = item_heights.iter().sum::<f32>()
                + 2.0 * padding
                + nested_spans
                    .iter()
                    .map(|span| 2.0 * span.padding)
                    .sum::<f32>();
            if total <= page_height + EPS {
                return Some(total);
            }
            let first = item_heights.first().copied().unwrap_or(0.0);
            // Fragmenting tables must carry the repeated header plus first row.
            let first_content = if repeat_headers.iter().any(|span| span.header_item == 0) {
                first + item_heights.get(1).copied().unwrap_or(0.0)
            } else {
                first
            };
            Some(first_content + 2.0 * padding)
        }
        FlowBlock::Graphic { height } | FlowBlock::Image { height } => Some(*height),
        FlowBlock::Paragraph {
            line_height,
            padding_before,
            ..
        } => Some(line_height + padding_before),
    }
}

/// Return the next visible block and the full intervening vertical gap.
/// Explicit page breaks (including break-before boxes) are hard boundaries.
fn following_visible(blocks: &[FlowBlock], start: usize, page_height: f32) -> Option<(usize, f32)> {
    let mut gap = 0.0;
    for (idx, block) in blocks.iter().enumerate().skip(start) {
        match block {
            FlowBlock::Spacer { height } => {
                if !height.is_finite() || *height <= 0.0 {
                    return None; // The regular spacer branch reports InvalidHeight.
                }
                gap += height;
            }
            _ if first_visible_height(block, page_height).is_some() => return Some((idx, gap)),
            _ => return None,
        }
    }
    None
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
    // Spacers skipped at implicit page boundaries are still validated.
    for item in blocks {
        if let FlowBlock::Spacer { height } = item
            && (!height.is_finite() || *height <= 0.0 || *height > page_height)
        {
            return Err(PaginationError::InvalidHeight);
        }
    }
    let mut skipped_until = 0usize;
    for (block, item) in blocks.iter().enumerate() {
        if block < skipped_until {
            continue;
        }
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
            if let Some((next_index, gap)) = following_visible(blocks, block + 1, page_height)
                && let Some(next_height) = first_visible_height(&blocks[next_index], page_height)
            {
                let needed = own_height + gap + next_height;
                if own_height.is_finite() && needed.is_finite() && needed <= page_height + EPS {
                    let current = pages.last().expect("initial page exists");
                    if current.used_height > 0.0 && current.used_height + needed > page_height + EPS
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
                nested_spans,
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
                // DFS spans are ordered parent-before-child, may be nested,
                // never partially intersect. Every continuation carries padding.
                let mut ancestors: Vec<BoxNestedSpan> = Vec::new();
                for span in nested_spans {
                    if span.start_item >= span.end_item
                        || span.end_item > item_heights.len()
                        || !span.padding.is_finite()
                        || !(0.0..=60.0).contains(&span.padding)
                    {
                        return Err(PaginationError::InvalidHeight);
                    }
                    while ancestors
                        .last()
                        .is_some_and(|a| a.end_item <= span.start_item)
                    {
                        ancestors.pop();
                    }
                    if let Some(a) = ancestors.last()
                        && span.end_item > a.end_item
                    {
                        return Err(PaginationError::InvalidHeight);
                    }
                    ancestors.push(*span);
                }
                let overhead = nested_spans.iter().map(|s| 2.0 * s.padding).sum::<f32>();
                let sum = item_heights.iter().sum::<f32>() + 2.0 * padding + overhead;
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
                    while end < item_heights.len() {
                        if nested_spans.iter().any(|span| {
                            span.start_item == end
                                && span.break_before
                                && (end > cursor || current.used_height > 0.0)
                        }) {
                            break;
                        }
                        let mut defer_group = false;
                        for span in nested_spans
                            .iter()
                            .filter(|span| span.start_item == end && span.keep_together)
                        {
                            let group_height = item_heights[span.start_item..span.end_item]
                                .iter()
                                .sum::<f32>()
                                + nested_spans
                                    .iter()
                                    .filter(|child| {
                                        child.start_item >= span.start_item
                                            && child.end_item <= span.end_item
                                    })
                                    .map(|child| 2.0 * child.padding)
                                    .sum::<f32>();
                            let ancestor_padding = nested_spans
                                .iter()
                                .filter(|parent| {
                                    parent.start_item <= span.start_item
                                        && parent.end_item >= span.end_item
                                        && (parent.start_item != span.start_item
                                            || parent.end_item != span.end_item)
                                })
                                .map(|parent| 2.0 * parent.padding)
                                .sum::<f32>();
                            if group_height + ancestor_padding + 2.0 * padding > page_height + EPS {
                                return Err(PaginationError::InvalidHeight);
                            }
                            if consumed + group_height > available + EPS {
                                defer_group = true;
                                break;
                            }
                        }
                        if defer_group {
                            break;
                        }
                        let newly_opened = nested_spans
                            .iter()
                            .filter(|span| {
                                span.start_item <= end
                                    && end < span.end_item
                                    && (end == cursor || span.start_item == end)
                            })
                            .map(|span| 2.0 * span.padding)
                            .sum::<f32>();
                        let increment = item_heights[end] + newly_opened;
                        if consumed + increment > available + EPS {
                            break;
                        }
                        consumed += increment;
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
                // A vertical separator belongs *between* visible blocks.
                // If it cannot stay with the first visible content after it,
                // start a fresh page and omit the separator there.
                // Leading spacers and spacers after explicit PageBreak are kept.
                if pages.last().is_some_and(|p| !p.fragments.is_empty())
                    && let Some((next_index, gap)) = following_visible(blocks, block, page_height)
                    && let Some(next_height) =
                        first_visible_height(&blocks[next_index], page_height)
                {
                    let current = pages.last().expect("page exists");
                    if current.used_height + gap + next_height > page_height + EPS {
                        pages.push(FlowPage {
                            fragments: Vec::new(),
                            used_height: 0.0,
                        });
                        skipped_until = next_index;
                        continue;
                    }
                }
                if pages.last().expect("page exists").used_height + height > page_height + EPS {
                    pages.push(FlowPage {
                        fragments: Vec::new(),
                        used_height: 0.0,
                    });
                }
                let current = pages.last_mut().expect("page exists");
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
    #[test]
    fn nested_container_charges_padding_on_every_continuation_page() {
        let block = FlowBlock::Box {
            item_heights: vec![20.0; 7],
            padding: 5.0,
            repeat_headers: vec![],
            nested_spans: vec![BoxNestedSpan {
                start_item: 1,
                end_item: 6,
                padding: 5.0,
                keep_together: false,
                break_before: false,
            }],
            keep_together: false,
            break_before: false,
        };
        let pages = paginate_flow(&[block], 80.0).unwrap();
        assert_eq!(pages.len(), 3);
        assert!(pages.iter().all(|p| p.used_height <= 80.0));
        assert!(matches!(&pages[0].fragments[0],
            FlowFragment::Box {start_item:0,end_item:3,height,..}
                if (*height-80.0).abs()<0.01));
        assert!(matches!(&pages[1].fragments[0],
            FlowFragment::Box {start_item:3,end_item:6,height,..}
                if (*height-80.0).abs()<0.01));
        assert!(matches!(&pages[2].fragments[0],
            FlowFragment::Box {start_item:6,end_item:7,height,..}
                if (*height-30.0).abs()<0.01));
    }
    #[test]
    fn nested_box_keep_together_and_break_before_are_enforced() {
        let boxed = |keep_together, break_before| FlowBlock::Box {
            item_heights: vec![20.0, 20.0, 20.0],
            padding: 5.0,
            repeat_headers: vec![],
            nested_spans: vec![BoxNestedSpan {
                start_item: 1,
                end_item: 3,
                padding: 5.0,
                keep_together,
                break_before,
            }],
            keep_together: false,
            break_before: false,
        };
        let kept = paginate_flow(&[boxed(true, false)], 70.0).unwrap();
        assert_eq!(kept.len(), 2);
        assert!(matches!(
            &kept[0].fragments[0],
            FlowFragment::Box {
                start_item: 0,
                end_item: 1,
                ..
            }
        ));
        assert!(matches!(
            &kept[1].fragments[0],
            FlowFragment::Box {
                start_item: 1,
                end_item: 3,
                ..
            }
        ));
        let broken = paginate_flow(&[boxed(false, true)], 90.0).unwrap();
        assert_eq!(broken.len(), 2);
        let too_tall = FlowBlock::Box {
            item_heights: vec![40.0, 40.0],
            padding: 10.0,
            repeat_headers: vec![],
            nested_spans: vec![BoxNestedSpan {
                start_item: 0,
                end_item: 2,
                padding: 10.0,
                keep_together: true,
                break_before: false,
            }],
            keep_together: false,
            break_before: false,
        };
        assert!(paginate_flow(&[too_tall], 90.0).is_err());
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
            nested_spans: vec![],
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
            nested_spans: vec![],
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
            nested_spans: vec![],
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
            nested_spans: vec![],
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
            nested_spans: vec![],
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
                nested_spans: vec![],
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
                nested_spans: vec![],
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
                nested_spans: vec![],
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
                    nested_spans: vec![],
                    keep_together: false,
                    break_before: false,
                }],
                110.0
            )
            .is_err()
        );
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
    fn keep_reserves_entire_box_when_box_itself_fits_on_fresh_page() {
        let blocks = [
            para(3),
            para(1),
            FlowBlock::Spacer { height: 5.0 },
            FlowBlock::Box {
                item_heights: vec![15.0, 15.0, 15.0],
                padding: 3.0,
                repeat_headers: vec![BoxRepeatSpan {
                    header_item: 0,
                    end_item: 3,
                }],
                nested_spans: vec![],
                keep_together: false,
                break_before: false,
            },
        ];
        let pages = paginate_flow_with_keep(&blocks, &[false, true, false, false], 100.0).unwrap();
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[0].fragments.len(), 1);
        assert!(matches!(
            pages[1].fragments[0],
            FlowFragment::Paragraph { block: 1, .. }
        ));
        assert!(matches!(
            pages[1].fragments[2],
            FlowFragment::Box { block: 3, .. }
        ));
    }
    #[test]
    fn heading_after_soft_gap_stays_with_table_header_and_first_row() {
        let blocks = [
            para(7),
            para(1),
            FlowBlock::Spacer { height: 5.0 },
            FlowBlock::Box {
                item_heights: vec![22.0, 25.0, 22.0],
                padding: 3.0,
                repeat_headers: vec![BoxRepeatSpan {
                    header_item: 0,
                    end_item: 3,
                }],
                nested_spans: vec![],
                keep_together: false,
                break_before: false,
            },
        ];
        let pages = paginate_flow_with_keep(&blocks, &[false, true, false, false], 100.0).unwrap();
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[0].fragments.len(), 1);
        assert!(matches!(
            pages[1].fragments[0],
            FlowFragment::Paragraph { block: 1, .. }
        ));
        assert!(matches!(
            pages[1].fragments[1],
            FlowFragment::Spacer { block: 2, .. }
        ));
        assert!(matches!(
            pages[1].fragments[2],
            FlowFragment::Box {
                block: 3,
                start_item: 0,
                ..
            }
        ));
    }
    #[test]
    fn heading_keep_with_next_crosses_multiple_separators() {
        let blocks = [
            para(7),
            para(1),
            FlowBlock::Spacer { height: 6.0 },
            FlowBlock::Spacer { height: 7.0 },
            FlowBlock::Image { height: 20.0 },
        ];
        // 77 + 17 + 6 + 7 + 20 cannot fit in the remaining 23pt,
        // but 17+13+20 fits easily on a fresh 100pt page.
        let pages =
            paginate_flow_with_keep(&blocks, &[false, true, false, false, false], 100.0).unwrap();
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[0].fragments.len(), 1);
        assert!(matches!(
            pages[1].fragments[0],
            FlowFragment::Paragraph { block: 1, .. }
        ));
        assert!(matches!(
            pages[1].fragments[1],
            FlowFragment::Spacer { block: 2, .. }
        ));
        assert!(matches!(
            pages[1].fragments[2],
            FlowFragment::Spacer { block: 3, .. }
        ));
        assert!(matches!(
            pages[1].fragments[3],
            FlowFragment::Image { block: 4, .. }
        ));
        assert_eq!(pages[1].used_height, 50.0);
    }
    #[test]
    fn separator_keeps_exact_space_when_both_contents_fit() {
        let blocks = [para(2), FlowBlock::Spacer { height: 12.0 }, para(1)];
        let pages = paginate_flow(&blocks, 100.0).unwrap();
        assert_eq!(pages.len(), 1);
        assert!(matches!(
            pages[0].fragments[1],
            FlowFragment::Spacer { height: 12.0, .. }
        ));
        assert!((pages[0].used_height - (27.0 + 12.0 + 17.0)).abs() < 0.01);
    }
    #[test]
    fn explicit_page_break_preserves_intentional_top_spacing() {
        let blocks = [
            para(7),
            FlowBlock::PageBreak,
            FlowBlock::Spacer { height: 14.0 },
            para(1),
        ];
        let pages = paginate_flow(&blocks, 100.0).unwrap();
        assert_eq!(pages.len(), 2);
        assert!(matches!(
            pages[1].fragments[0],
            FlowFragment::Spacer {
                block: 2,
                height: 14.0
            }
        ));
        assert!(matches!(
            pages[1].fragments[1],
            FlowFragment::Paragraph { block: 3, .. }
        ));
    }
    #[test]
    fn first_page_leading_spacer_is_not_automatically_trimmed() {
        let pages = paginate_flow(&[FlowBlock::Spacer { height: 11.0 }, para(2)], 100.0).unwrap();
        assert_eq!(pages.len(), 1);
        assert!(matches!(
            pages[0].fragments[0],
            FlowFragment::Spacer { block: 0, .. }
        ));
        assert_eq!(pages[0].used_height, 38.0);
    }
    #[test]
    fn keep_does_not_jump_over_explicit_page_break() {
        let blocks = [
            para(1),
            FlowBlock::PageBreak,
            FlowBlock::Spacer { height: 5.0 },
            para(1),
        ];
        let pages = paginate_flow_with_keep(&blocks, &[true, false, false, false], 100.0).unwrap();
        assert_eq!(pages.len(), 2);
        assert!(matches!(
            pages[0].fragments[0],
            FlowFragment::Paragraph { block: 0, .. }
        ));
        assert!(matches!(
            pages[1].fragments[0],
            FlowFragment::Spacer { block: 2, .. }
        ));
    }
    #[test]
    fn invalid_gap_in_suppressed_run_still_fails_preflight() {
        let blocks = [
            para(7),
            FlowBlock::Spacer { height: 12.0 },
            FlowBlock::Spacer { height: f32::NAN },
            FlowBlock::Image { height: 35.0 },
        ];
        assert!(paginate_flow(&blocks, 100.0).is_err());
    }
    #[test]
    fn separator_drops_at_implicit_page_boundary_but_validates_input() {
        let pages = paginate_flow(
            &[para(4), FlowBlock::Spacer { height: 45.0 }, para(1)],
            80.0,
        )
        .unwrap();
        assert_eq!(pages.len(), 2);
        assert!(matches!(
            pages[1].fragments[0],
            FlowFragment::Paragraph { block: 2, .. }
        ));
        assert!(pages.iter().all(|p| {
            p.fragments
                .iter()
                .all(|f| !matches!(f, FlowFragment::Spacer { block: 1, .. }))
        }));

        assert!(pages.iter().all(|p| p.used_height <= 80.0));
        assert!(paginate_flow(&[FlowBlock::Spacer { height: f32::NAN }], 80.0).is_err());
    }
}
