//! Paginated decorated containers: stacked content, caller-defined padding,
//! RGB fills and borders. Long text is split into line-height fragments.
use crate::image::PreparedImage;
use crate::rich_text::{FontRegistry, RichLine, prepare_rich};
use crate::row::PreparedRow;
use crate::{
    PdfGraphic, PdfImage, PdfRow, PdfTextRun, RenderError, TextStyle, check_cancel,
    measure_text_lines,
};
use krilla::{
    geom::Point,
    surface::Surface,
    text::{Font, TextDirection},
};
use parley::{FontContext, LayoutContext};
use std::sync::atomic::AtomicBool;
use vufra_layout::{
    flow::{BoxNestedSpan, BoxRepeatSpan},
    tree::{FlattenedLayout, LayoutNode},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BoxAlign {
    Left,
    Center,
    Right,
}
#[derive(Debug, Clone)]
pub enum PdfBoxItem {
    Text {
        text: String,
        style: TextStyle,
        color: Option<[u8; 3]>,
    },
    RichText {
        runs: Vec<PdfTextRun>,
        style: TextStyle,
    },
    Image(PdfImage),
    Graphic(PdfGraphic),
    Row(PdfRow),
    Table(PdfBoxTable),
    Box(Box<PdfBox>),
    Spacer(f32),
}
#[derive(Debug, Clone)]
pub struct PdfBox {
    pub width: Option<f32>,
    pub align: BoxAlign,
    pub padding: f32,
    pub padding_sides: Option<crate::CellPadding>,
    pub min_height: Option<f32>,
    pub max_height: Option<f32>,
    pub space_between: bool,
    pub border_width: f32,
    pub radius: f32,
    pub border_color: Option<[u8; 3]>,
    pub background: Option<[u8; 3]>,
    pub keep_together: bool,
    pub break_before: bool,
    pub keep_with_next: bool,
    pub items: Vec<PdfBoxItem>,
}
/// Bounded, rich table inside a decorated box. Each row is atomic; the header
/// is repainted on continuation pages by the outer page compositor.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CellBorder {
    pub width: f32,
    pub color: [u8; 3],
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TableRowSpan {
    /// Zero-based body row, and zero-based logical header column.
    pub row: usize,
    pub column: usize,
    pub col_span: usize,
    pub row_span: usize,
}
#[derive(Debug, Clone)]
pub struct PdfBoxTable {
    pub row_spans: Vec<TableRowSpan>,
    /// Zero-based body row indices whose group heading must stay with its next row.
    pub keep_with_next: Vec<usize>,
    pub header: PdfRow,
    pub rows: Vec<PdfRow>,
    /// RGB fills: header at index zero, then each body row, one per column.
    pub fills: Vec<Vec<Option<[u8; 3]>>>,
    pub borders: Option<Vec<Vec<CellBorder>>>,
}
impl PdfBoxTable {
    fn validate(&self, width: f32, height: f32, depth: usize) -> Result<(), RenderError> {
        if self.rows.is_empty()
            || self.rows.len() > 1_000
            || self.fills.len() != self.rows.len() + 1
            || self
                .borders
                .as_ref()
                .is_some_and(|b| b.len() != self.fills.len())
        {
            return Err(RenderError::InvalidInput(
                "styled table requires 1..1000 rows and fills",
            ));
        }
        if self
            .keep_with_next
            .windows(2)
            .any(|items| items[0] >= items[1])
            || self
                .keep_with_next
                .iter()
                .any(|&i| i + 1 >= self.rows.len())
        {
            return Err(RenderError::InvalidInput(
                "invalid table group keepWithNext indices",
            ));
        }
        let cols = self.header.columns.len();
        if cols == 0 || cols > 6 || self.header.gap != 0.0 {
            return Err(RenderError::InvalidInput(
                "styled table requires 1..6 contiguous columns",
            ));
        }
        self.header.validate_depth(width, height, depth + 1)?;
        let boundaries = self
            .header
            .columns
            .iter()
            .scan(0.0_f32, |sum, col| {
                *sum += col.width;
                Some(*sum)
            })
            .collect::<Vec<_>>();
        for (i, row) in std::iter::once(&self.header).chain(&self.rows).enumerate() {
            row.validate_depth(width, height, depth + 1)?;
            let mut x = 0.0;
            let valid_spans = row.columns.iter().all(|col| {
                x += col.width;
                boundaries.iter().any(|bound| (x - bound).abs() < 0.02)
            }) && (x - boundaries.last().copied().unwrap_or(0.0)).abs() < 0.02;
            if row.columns.is_empty()
                || row.columns.len() > cols
                || row.gap != 0.0
                || !valid_spans
                || self.fills[i].len() != row.columns.len()
                || self.borders.as_ref().is_some_and(|b| {
                    b[i].len() != row.columns.len()
                        || b[i].iter().any(|edge| {
                            !edge.width.is_finite() || !(0.0..=4.0).contains(&edge.width)
                        })
                })
            {
                return Err(RenderError::InvalidInput(
                    "styled table column widths must match",
                ));
            }
        }
        if self.row_spans.len() > self.rows.len() * cols {
            return Err(RenderError::InvalidInput("too many table rowSpans"));
        }
        let mut coverage = vec![vec![false; cols]; self.rows.len()];
        for span in &self.row_spans {
            if span.row >= self.rows.len()
                || span.row_span < 2
                || span.row_span > 32
                || span
                    .row
                    .checked_add(span.row_span)
                    .is_none_or(|last| last > self.rows.len())
                || span.col_span < 1
                || span
                    .column
                    .checked_add(span.col_span)
                    .is_none_or(|end| end > cols)
            {
                return Err(RenderError::InvalidInput("invalid table rowSpan bounds"));
            }
            let start = boundaries[span.column] - self.header.columns[span.column].width;
            let finish = boundaries[span.column + span.col_span - 1];
            for (r, cover_row) in coverage
                .iter_mut()
                .enumerate()
                .skip(span.row)
                .take(span.row_span)
            {
                let mut x = 0.0;
                let mut matched = false;
                for c in &self.rows[r].columns {
                    let left = x;
                    x += c.width;
                    if (left - start).abs() < 0.02 {
                        if (x - finish).abs() > 0.02 {
                            return Err(RenderError::InvalidInput(
                                "table rowSpan cell width mismatch",
                            ));
                        }
                        if r > span.row
                            && !c
                                .items
                                .iter()
                                .all(|item| matches!(item, crate::PdfRowItem::Spacer(_)))
                        {
                            return Err(RenderError::InvalidInput(
                                "table rowSpan continuation requires empty cells",
                            ));
                        }
                        matched = true;
                    }
                }
                if !matched {
                    return Err(RenderError::InvalidInput("missing table rowSpan slot"));
                }
                for covered in cover_row.iter_mut().skip(span.column).take(span.col_span) {
                    if *covered {
                        return Err(RenderError::InvalidInput("overlapping table rowSpans"));
                    }
                    *covered = true;
                }
            }
        }
        Ok(())
    }
}
enum PreparedContent {
    Text {
        text: String,
        size: f32,
        color: Option<[u8; 3]>,
        before: f32,
        line_height: f32,
    },
    Rich {
        line: RichLine,
        before: f32,
        line_height: f32,
    },
    Image(PreparedImage, usize),
    Graphic(usize),
    Row(PreparedRow, usize),
    SplitRow(PreparedRow, PdfRow),
    TableRow(PreparedRow, usize, usize),
    TableRowFragment(PreparedRow, PdfRow, usize, usize),
    Box(Box<PreparedBox>, usize),
    Spacer,
}
struct PreparedItem {
    height: f32,
    kind: PreparedContent,
    /// DFS indices in the flattened leaf stream, used for page-local painting.
    flat_start: usize,
    flat_end: usize,
}
pub struct PreparedBox {
    pub item_heights: Vec<f32>,
    pub image_pixels: u64,
    pub repeat_headers: Vec<BoxRepeatSpan>,
    pub nested_spans: Vec<BoxNestedSpan>,
    layout_nodes: Vec<LayoutNode>,
    width: f32,
    x: f32,
    padding: f32,
    padding_top: f32,
    padding_left: f32,
    border_width: f32,
    radius: f32,
    border_color: Option<[u8; 3]>,
    background: Option<[u8; 3]>,
    items: Vec<PreparedItem>,
}

impl PdfBox {
    fn sides(&self) -> crate::CellPadding {
        self.padding_sides.unwrap_or(crate::CellPadding {
            top: self.padding,
            right: self.padding,
            bottom: self.padding,
            left: self.padding,
        })
    }
    /// Lower PDF-specific prepared leaves to the writer-independent geometry
    /// tree. One measurement model serves text, images, rows, tables and boxes.
    fn layout_nodes_for(
        items: &[PreparedItem],
        sources: &[PdfBoxItem],
    ) -> Result<Vec<LayoutNode>, RenderError> {
        let mut nodes = Vec::new();
        let mut i = 0;
        while i < items.len() {
            match &items[i].kind {
                PreparedContent::Box(nested, source_idx) => {
                    let Some(PdfBoxItem::Box(original)) = sources.get(*source_idx) else {
                        return Err(RenderError::InvalidInput("nested box source mismatch"));
                    };
                    nodes.push(LayoutNode::Container {
                        padding: nested.padding,
                        keep_together: original.keep_together,
                        break_before: original.break_before,
                        children: nested.layout_nodes.clone(),
                    });
                    i += 1;
                }
                PreparedContent::TableRow(_, table_idx, 0) => {
                    let header = items[i].height;
                    i += 1;
                    let mut rows = Vec::new();
                    while i < items.len() {
                        let belongs = matches!(&items[i].kind,
                            PreparedContent::TableRow(_,source,_) |
                            PreparedContent::TableRowFragment(_,_,source,_)
                            if source==table_idx);
                        if belongs {
                            rows.push(items[i].height);
                            i += 1;
                        } else {
                            break;
                        }
                    }
                    nodes.push(LayoutNode::RepeatTable { header, rows });
                }
                PreparedContent::TableRow(..) | PreparedContent::TableRowFragment(..) => {
                    return Err(RenderError::InvalidInput("table row without header"));
                }
                _ => {
                    nodes.push(LayoutNode::Leaf(items[i].height));
                    i += 1;
                }
            }
        }
        Ok(nodes)
    }
    pub fn validate(&self, width: f32, page_height: f32) -> Result<(), RenderError> {
        self.validate_depth(width, page_height, 0)
    }
    pub(crate) fn validate_depth(
        &self,
        width: f32,
        page_height: f32,
        depth: usize,
    ) -> Result<(), RenderError> {
        if depth > 8 {
            return Err(RenderError::InvalidInput("nested box depth exceeds 8"));
        }
        let w = self.width.unwrap_or(width);
        let p = self.sides();
        let vertical = p.top + p.bottom;
        let horizontal = p.left + p.right;
        if !w.is_finite()
            || w < 100.0
            || w > width + 0.01
            || self.max_height.is_some_and(|h| {
                !h.is_finite()
                    || h <= 0.0
                    || h > 20000.0
                    || self.min_height.is_some_and(|min| min > h)
                    || h < vertical
            })
            || self
                .min_height
                .is_some_and(|h| !h.is_finite() || h < 0.0 || h > page_height)
            || [p.top, p.right, p.bottom, p.left]
                .iter()
                .any(|v| !v.is_finite() || !(0.0..=60.0).contains(v))
            || !self.padding.is_finite()
            || !(0.0..=60.0).contains(&self.padding)
            || !self.border_width.is_finite()
            || !(0.0..=6.0).contains(&self.border_width)
            || self.border_width > p.top.min(p.bottom).min(p.left).min(p.right)
            || !self.radius.is_finite()
            || self.radius < 0.0
            || self.radius > 24.0
            || self.radius > p.top.min(p.bottom).min(p.left).min(p.right)
            || w - horizontal < 60.0
            || vertical + 1.0 > page_height
            || self.items.is_empty()
            || self.items.len() > 500
            || (self.space_between
                && (self.min_height.is_none() || self.items.len() < 2 || self.items.len() > 32))
        {
            return Err(RenderError::InvalidInput(
                "invalid box width, padding, border or item count",
            ));
        }
        for item in &self.items {
            match item {
                PdfBoxItem::Text { text, style, .. } => {
                    if text.contains('\0') {
                        return Err(RenderError::InvalidInput("box text contains null byte"));
                    }
                    style.validate(page_height - vertical)?;
                }
                PdfBoxItem::RichText { runs, style } => {
                    style.validate(page_height - vertical)?;
                    if runs.is_empty() || runs.len() > 1_000 {
                        return Err(RenderError::InvalidInput("invalid box rich text runs"));
                    }
                }
                PdfBoxItem::Image(image) => {
                    image.validate_box(w - horizontal, page_height - vertical)?
                }
                PdfBoxItem::Graphic(g) => g.validate(w - horizontal, page_height - vertical)?,
                PdfBoxItem::Row(r) => {
                    r.validate_depth(w - horizontal, page_height - vertical, depth + 1)?
                }
                PdfBoxItem::Table(t) => {
                    t.validate(w - horizontal, page_height - vertical, depth + 1)?
                }
                PdfBoxItem::Box(boxed) => {
                    boxed.validate_depth(w - horizontal, page_height - vertical, depth + 1)?
                }
                PdfBoxItem::Spacer(h)
                    if !h.is_finite() || *h <= 0.0 || *h + vertical > page_height =>
                {
                    return Err(RenderError::InvalidInput("invalid box spacer height"));
                }
                PdfBoxItem::Spacer(_) => {}
            }
        }
        Ok(())
    }
    pub fn prepare(
        &self,
        page: (f32, f32),
        family: &str,
        fonts: &mut FontContext,
        context: &mut LayoutContext<()>,
        registry: &mut FontRegistry,
        cancel: &AtomicBool,
    ) -> Result<PreparedBox, RenderError> {
        self.prepare_depth(page, family, fonts, context, registry, cancel, 0)
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare_depth(
        &self,
        page: (f32, f32),
        family: &str,
        fonts: &mut FontContext,
        context: &mut LayoutContext<()>,
        registry: &mut FontRegistry,
        cancel: &AtomicBool,
        depth: usize,
    ) -> Result<PreparedBox, RenderError> {
        let (page_width, page_height) = page;
        self.validate_depth(page_width, page_height, depth)?;
        let width = self.width.unwrap_or(page_width);
        let p = self.sides();
        let vertical = p.top + p.bottom;
        let inner = width - p.left - p.right;
        let x = match self.align {
            BoxAlign::Left => 0.0,
            BoxAlign::Center => (page_width - width) * 0.5,
            BoxAlign::Right => page_width - width,
        };
        let mut items = Vec::new();
        let mut boundaries = Vec::new();
        let mut pixels = 0u64;
        for (idx, item) in self.items.iter().enumerate() {
            check_cancel(cancel)?;
            if idx > 0 {
                boundaries.push(items.len());
            }
            match item {
                PdfBoxItem::Text { text, style, color } => {
                    let lines = measure_text_lines(
                        text,
                        inner,
                        family,
                        fonts,
                        context,
                        style.font_size,
                        cancel,
                    )?;
                    for (line_idx, line) in lines.iter().enumerate() {
                        let before = if line_idx == 0 {
                            style.space_before
                        } else {
                            0.0
                        };
                        let after = if line_idx + 1 == lines.len() {
                            style.space_after
                        } else {
                            0.0
                        };
                        let height = before + style.line_height + after;
                        items.push(PreparedItem {
                            flat_start: 0,
                            flat_end: 0,
                            height,
                            kind: PreparedContent::Text {
                                text: line.clone(),
                                size: style.font_size,
                                color: *color,
                                before,
                                line_height: style.line_height,
                            },
                        });
                    }
                }
                PdfBoxItem::RichText { runs, style } => {
                    let lines = prepare_rich(runs, *style, inner, registry, cancel)?;
                    let largest = runs
                        .iter()
                        .map(|r| r.font_size.unwrap_or(style.font_size))
                        .fold(style.font_size, f32::max);
                    let line_height = style.line_height.max(largest * 1.35);
                    let len = lines.len();
                    for (line_idx, line) in lines.into_iter().enumerate() {
                        let before = if line_idx == 0 {
                            style.space_before
                        } else {
                            0.0
                        };
                        let after = if line_idx + 1 == len {
                            style.space_after
                        } else {
                            0.0
                        };
                        items.push(PreparedItem {
                            flat_start: 0,
                            flat_end: 0,
                            height: before + line_height + after,
                            kind: PreparedContent::Rich {
                                line,
                                before,
                                line_height,
                            },
                        });
                    }
                }
                PdfBoxItem::Image(img) => {
                    let prepared = img.prepare()?;
                    pixels = pixels.saturating_add(prepared.pixel_count());
                    items.push(PreparedItem {
                        flat_start: 0,
                        flat_end: 0,
                        height: img.height,
                        kind: PreparedContent::Image(prepared, idx),
                    });
                }
                PdfBoxItem::Graphic(g) => items.push(PreparedItem {
                    flat_start: 0,
                    flat_end: 0,
                    height: g.height,
                    kind: PreparedContent::Graphic(idx),
                }),
                PdfBoxItem::Row(r) => {
                    match r.prepare_allow_overflow_depth(
                        (inner, page_height - vertical),
                        family,
                        fonts,
                        context,
                        registry,
                        cancel,
                        depth + 1,
                    ) {
                        Ok(prepared) if prepared.height <= page_height - vertical + 0.001 => {
                            pixels = pixels.saturating_add(prepared.image_pixels);
                            items.push(PreparedItem {
                                flat_start: 0,
                                flat_end: 0,
                                height: prepared.height,
                                kind: PreparedContent::Row(prepared, idx),
                            });
                        }
                        Ok(prepared) => {
                            for segment in r.fragments_from_prepared(prepared)?.items {
                                let PdfBoxItem::Row(source_row) = segment else {
                                    unreachable!("split row contains only rows");
                                };
                                let prepared = source_row.prepare_depth(
                                    (inner, page_height - vertical),
                                    family,
                                    fonts,
                                    context,
                                    registry,
                                    cancel,
                                    depth + 1,
                                )?;
                                pixels = pixels.saturating_add(prepared.image_pixels);
                                items.push(PreparedItem {
                                    flat_start: 0,
                                    flat_end: 0,
                                    height: prepared.height,
                                    kind: PreparedContent::SplitRow(prepared, source_row),
                                });
                            }
                        }
                        Err(error) => return Err(error),
                    }
                }
                PdfBoxItem::Table(table) => {
                    table.validate(inner, page_height - vertical, depth + 1)?;
                    for (row_idx, row) in std::iter::once(&table.header)
                        .chain(table.rows.iter())
                        .enumerate()
                    {
                        check_cancel(cancel)?;
                        match row.prepare_allow_overflow_depth(
                            (inner, page_height - vertical),
                            family,
                            fonts,
                            context,
                            registry,
                            cancel,
                            depth + 1,
                        ) {
                            Ok(prepared) if prepared.height <= page_height - vertical + 0.001 => {
                                pixels = pixels.saturating_add(prepared.image_pixels);
                                items.push(PreparedItem {
                                    flat_start: 0,
                                    flat_end: 0,
                                    height: prepared.height.max(1.0),
                                    kind: PreparedContent::TableRow(prepared, idx, row_idx),
                                });
                            }
                            Ok(prepared) if row_idx > 0 => {
                                if table.row_spans.iter().any(|span| {
                                    let body = row_idx - 1;
                                    body >= span.row && body < span.row + span.row_span
                                }) {
                                    return Err(RenderError::InvalidInput(
                                        "rowSpan does not support individual rows taller than a page",
                                    ));
                                }
                                // Preserve the source table-row fill and repeat only
                                // the body fragments; reuse measured lines/font faces.
                                let fragments = row.fragments_from_prepared(prepared)?;
                                for source in fragments.items {
                                    let PdfBoxItem::Row(fragment) = source else {
                                        unreachable!("row fragment contains only rows")
                                    };
                                    let prepared = fragment.prepare_depth(
                                        (inner, page_height - vertical),
                                        family,
                                        fonts,
                                        context,
                                        registry,
                                        cancel,
                                        depth + 1,
                                    )?;
                                    pixels = pixels.saturating_add(prepared.image_pixels);
                                    items.push(PreparedItem {
                                        flat_start: 0,
                                        flat_end: 0,
                                        height: prepared.height.max(1.0),
                                        kind: PreparedContent::TableRowFragment(
                                            prepared, fragment, idx, row_idx,
                                        ),
                                    });
                                }
                            }
                            Ok(_) => {
                                return Err(RenderError::InvalidInput(
                                    "row height exceeds printable page; split content into multiple rows",
                                ));
                            }
                            Err(error) => return Err(error),
                        }
                    }
                }
                PdfBoxItem::Box(boxed) => {
                    let nested = boxed.prepare_depth(
                        (inner, page_height - vertical),
                        family,
                        fonts,
                        context,
                        registry,
                        cancel,
                        depth + 1,
                    )?;
                    pixels = pixels.saturating_add(nested.image_pixels);
                    let nested_height = nested.total_height();
                    items.push(PreparedItem {
                        flat_start: 0,
                        flat_end: 0,
                        height: nested_height,
                        kind: PreparedContent::Box(Box::new(nested), idx),
                    });
                }
                PdfBoxItem::Spacer(h) => items.push(PreparedItem {
                    flat_start: 0,
                    flat_end: 0,
                    height: *h,
                    kind: PreparedContent::Spacer,
                }),
            }
        }
        // Reserve intrinsic vertical space only after measuring all actual
        // content. It is a real leaf so pagination/backgrounds agree, without
        // imposing arbitrary PDF positions from TypeScript.
        if let Some(minimum) = self.min_height {
            let actual = items.iter().map(|item| item.height).sum::<f32>() + vertical;
            let deficit = minimum - actual;
            if deficit > 0.001 {
                if self.space_between {
                    let each = deficit / boundaries.len() as f32;
                    // Insert from the end so the original child boundaries
                    // stay stable. No gap is inserted inside a wrapped line,
                    // repeated table or nested box.
                    for at in boundaries.into_iter().rev() {
                        items.insert(
                            at,
                            PreparedItem {
                                flat_start: 0,
                                flat_end: 0,
                                height: each,
                                kind: PreparedContent::Spacer,
                            },
                        );
                    }
                } else {
                    items.push(PreparedItem {
                        flat_start: 0,
                        flat_end: 0,
                        height: deficit,
                        kind: PreparedContent::Spacer,
                    });
                }
            }
        }
        if items.len() > 10_000 {
            return Err(RenderError::InvalidInput("too many box text lines"));
        }
        let layout_nodes = Self::layout_nodes_for(&items, &self.items)?;
        let flattened =
            FlattenedLayout::from_nodes(&layout_nodes).map_err(RenderError::InvalidLayout)?;
        let mut offset = 0usize;
        for item in &mut items {
            item.flat_start = offset;
            offset += if let PreparedContent::Box(nested, _) = &item.kind {
                nested.item_heights.len()
            } else {
                1
            };
            item.flat_end = offset;
        }
        if offset != flattened.heights.len() {
            return Err(RenderError::InvalidInput(
                "measured tree leaf range mismatch",
            ));
        }
        // Keep short group headings with the first following data row using
        // the existing native keep-together pagination rule. Zero padding
        // introduces no extra geometry or painting. Oversized pairs degrade
        // to ordinary pagination rather than failing a valid long report.
        let mut nested_spans = flattened.groups;
        for (idx, item) in items.iter().enumerate() {
            if let PreparedContent::TableRow(_, table_idx, row_idx) = &item.kind {
                if *row_idx == 0 {
                    continue;
                }
                let Some(PdfBoxItem::Table(table)) = self.items.get(*table_idx) else {
                    continue;
                };
                if !table.keep_with_next.contains(&(*row_idx - 1)) {
                    continue;
                }
                let Some(next) = items.get(idx + 1) else {
                    continue;
                };
                let next_row = match &next.kind {
                    PreparedContent::TableRow(_, source, next_row)
                    | PreparedContent::TableRowFragment(_, _, source, next_row) => {
                        *source == *table_idx && *next_row == *row_idx + 1
                    }
                    _ => false,
                };
                if !next_row {
                    continue;
                }
                let combined = item.height + next.height + vertical;
                if combined <= page_height + 0.001 {
                    nested_spans.push(vufra_layout::flow::BoxNestedSpan {
                        start_item: item.flat_start,
                        end_item: next.flat_end,
                        padding: 0.0,
                        keep_together: true,
                        break_before: false,
                    });
                }
            }
        }
        // Nested boxes may also have group spans, which need to reach the
        // top-level page paginator in their correct parent-local DFS range.
        for item in &items {
            if let PreparedContent::Box(nested, _) = &item.kind {
                for group in &nested.nested_spans {
                    if group.padding == 0.0 && group.keep_together {
                        nested_spans.push(vufra_layout::flow::BoxNestedSpan {
                            start_item: item.flat_start + group.start_item,
                            end_item: item.flat_start + group.end_item,
                            ..*group
                        });
                    }
                }
            }
        }
        nested_spans.sort_by(|a, b| {
            a.start_item
                .cmp(&b.start_item)
                .then(b.end_item.cmp(&a.end_item))
        });
        let measured = PreparedBox {
            item_heights: flattened.heights,
            image_pixels: pixels,
            repeat_headers: flattened.headers,
            nested_spans,
            layout_nodes,
            width,
            x,
            padding: vertical / 2.0,
            padding_top: p.top,
            padding_left: p.left,
            border_width: self.border_width,
            radius: self.radius,
            border_color: self.border_color,
            background: self.background,
            items,
        };
        if self
            .max_height
            .is_some_and(|h| measured.total_height() > h + 0.01)
        {
            return Err(RenderError::InvalidInput(
                "box content exceeds maxHeight; clipping is unsupported",
            ));
        }
        Ok(measured)
    }
}
fn rect(
    surface: &mut Surface,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    rgb: [u8; 3],
) -> Result<(), RenderError> {
    if w <= 0.0 || h <= 0.0 {
        return Ok(());
    }
    PdfGraphic {
        kind: crate::GraphicKind::Rectangle,
        width: w,
        height: h,
        rgb,
    }
    .draw(surface, x, y)
}
/// Round only the authored start and end. A repeated table header does
/// not create another first border on intermediate pages.
fn rounded_background(
    surface: &mut Surface,
    area: (f32, f32, f32, f32),
    radius: f32,
    first: bool,
    last: bool,
    color: [u8; 3],
) -> Result<(), RenderError> {
    use krilla::{color::rgb, geom::PathBuilder, paint::Fill};
    let (x, y, w, h) = area;
    let top = if first { radius } else { 0.0 };
    let bottom = if last { radius } else { 0.0 };
    let mut shape = PathBuilder::new();
    shape.move_to(x + top, y);
    shape.line_to(x + w - top, y);
    if top > 0.0 {
        shape.quad_to(x + w, y, x + w, y + top);
    }
    shape.line_to(x + w, y + h - bottom);
    if bottom > 0.0 {
        shape.quad_to(x + w, y + h, x + w - bottom, y + h);
    }
    shape.line_to(x + bottom, y + h);
    if bottom > 0.0 {
        shape.quad_to(x, y + h, x, y + h - bottom);
    }
    shape.line_to(x, y + top);
    if top > 0.0 {
        shape.quad_to(x, y, x + top, y);
    }
    shape.close();
    let path = shape
        .finish()
        .ok_or(RenderError::InvalidInput("rounded box path"))?;
    let old_fill = surface.get_fill().cloned();
    let old_stroke = surface.get_stroke().cloned();
    surface.set_stroke(None);
    surface.set_fill(Some(Fill {
        paint: rgb::Color::new(color[0], color[1], color[2]).into(),
        ..Fill::default()
    }));
    surface.draw_path(&path);
    surface.set_fill(old_fill);
    surface.set_stroke(old_stroke);
    Ok(())
}

/// Curved caps only on first/last authored fragments. Vertical border sides
/// remain straight on intermediate pages.
fn rounded_border(
    surface: &mut Surface,
    area: (f32, f32, f32, f32),
    radius: f32,
    border: f32,
    first: bool,
    last: bool,
    color: [u8; 3],
) -> Result<(), RenderError> {
    use krilla::{color::rgb, geom::PathBuilder, paint::Stroke};
    let (x, y, w, h) = area;
    let top = if first { radius } else { 0.0 };
    let bottom = if last { radius } else { 0.0 };
    let mid_height = h - top - bottom;
    rect(surface, x, y + top, border, mid_height, color)?;
    rect(surface, x + w - border, y + top, border, mid_height, color)?;
    let draw_cap = |surface: &mut Surface, top_cap: bool| -> Result<(), RenderError> {
        let center = border * 0.5;
        let r = radius.max(center);
        let mut shape = PathBuilder::new();
        if top_cap {
            shape.move_to(x + center, y + r);
            shape.quad_to(x + center, y + center, x + r, y + center);
            shape.line_to(x + w - r, y + center);
            shape.quad_to(x + w - center, y + center, x + w - center, y + r);
        } else {
            shape.move_to(x + center, y + h - r);
            shape.quad_to(x + center, y + h - center, x + r, y + h - center);
            shape.line_to(x + w - r, y + h - center);
            shape.quad_to(x + w - center, y + h - center, x + w - center, y + h - r);
        }
        let path = shape
            .finish()
            .ok_or(RenderError::InvalidInput("rounded border path"))?;
        let old_fill = surface.get_fill().cloned();
        let old_stroke = surface.get_stroke().cloned();
        surface.set_fill(None);
        surface.set_stroke(Some(Stroke {
            paint: rgb::Color::new(color[0], color[1], color[2]).into(),
            width: border,
            ..Stroke::default()
        }));
        surface.draw_path(&path);
        surface.set_fill(old_fill);
        surface.set_stroke(old_stroke);
        Ok(())
    };
    if first {
        draw_cap(surface, true)?;
    }
    if last {
        draw_cap(surface, false)?;
    }
    Ok(())
}

pub struct BoxFragmentPosition {
    pub left: f32,
    pub top: f32,
    pub start: usize,
    pub end: usize,
    pub repeat_header: Option<usize>,
    pub first: bool,
    pub last: bool,
    pub height: f32,
}
impl PreparedBox {
    pub(crate) fn total_height(&self) -> f32 {
        self.item_heights.iter().sum::<f32>()
            + 2.0 * self.padding
            + self
                .nested_spans
                .iter()
                .map(|span| 2.0 * span.padding)
                .sum::<f32>()
    }
    #[allow(clippy::too_many_arguments)]
    fn draw_table_row(
        &self,
        source: &PdfBox,
        surface: &mut Surface,
        font: &Font,
        registry: &FontRegistry,
        origin: (f32, f32),
        prepared: &PreparedRow,
        table_idx: usize,
        row_idx: usize,
        row_override: Option<&PdfRow>,
        cancel: &AtomicBool,
    ) -> Result<(), RenderError> {
        use krilla::{
            color::rgb,
            geom::{PathBuilder, Rect},
            paint::{Fill, Stroke},
        };
        let table = match source.items.get(table_idx) {
            Some(PdfBoxItem::Table(t)) => t,
            _ => return Err(RenderError::InvalidInput("invalid styled table source")),
        };
        let row = row_override.unwrap_or_else(|| {
            if row_idx == 0 {
                &table.header
            } else {
                &table.rows[row_idx - 1]
            }
        });
        let mut x = origin.0;
        let mut relative_x = 0.0;
        let header_boundaries = table
            .header
            .columns
            .iter()
            .scan(0.0_f32, |total, col| {
                *total += col.width;
                Some(*total)
            })
            .collect::<Vec<_>>();
        for (index, col) in row.columns.iter().enumerate() {
            let cell_start = relative_x;
            relative_x += col.width;
            let spanning = if row_idx == 0 {
                None
            } else {
                table.row_spans.iter().find(|span| {
                    let from =
                        header_boundaries[span.column] - table.header.columns[span.column].width;
                    let to = header_boundaries[span.column + span.col_span - 1];
                    (cell_start - from).abs() < 0.02
                        && (relative_x - to).abs() < 0.02
                        && row_idx > span.row
                        && row_idx - 1 < span.row + span.row_span
                })
            };
            let owner_index = spanning.and_then(|span| {
                let from = header_boundaries[span.column] - table.header.columns[span.column].width;
                let mut sum = 0.0_f32;
                table.rows[span.row]
                    .columns
                    .iter()
                    .position(|c| {
                        let at = sum;
                        sum += c.width;
                        (at - from).abs() < 0.02
                    })
                    .map(|index| (span.row + 1, index))
            });
            let style_row = owner_index.map_or(row_idx, |(r, _)| r);
            let style_col = owner_index.map_or(index, |(_, c)| c);
            let fill = table.fills[style_row][style_col].unwrap_or(if style_row == 0 {
                [225, 236, 249]
            } else if style_row.is_multiple_of(2) {
                [247, 250, 253]
            } else {
                [255, 255, 255]
            });
            let old_fill = surface.get_fill().cloned();
            let old_stroke = surface.get_stroke().cloned();
            surface.set_fill(Some(Fill {
                paint: rgb::Color::new(fill[0], fill[1], fill[2]).into(),
                ..Fill::default()
            }));
            let edge = table.borders.as_ref().map_or(
                CellBorder {
                    width: 0.5,
                    color: [187, 197, 207],
                },
                |b| b[style_row][style_col],
            );
            surface.set_stroke(if edge.width > 0.0 {
                Some(Stroke {
                    paint: rgb::Color::new(edge.color[0], edge.color[1], edge.color[2]).into(),
                    width: edge.width,
                    ..Stroke::default()
                })
            } else {
                None
            });
            if let Some(rect) = Rect::from_xywh(x, origin.1, col.width, prepared.height) {
                let mut path = PathBuilder::new();
                path.push_rect(rect);
                if let Some(path) = path.finish() {
                    if spanning.is_some() {
                        // One logical spanning cell: background on each page
                        // fragment, but only outer perimeter is stroked.
                        surface.set_stroke(None);
                    }
                    surface.draw_path(&path);
                }
                if let Some(span) = spanning
                    && edge.width > 0.0
                {
                    surface.set_fill(None);
                    surface.set_stroke(Some(Stroke {
                        paint: rgb::Color::new(edge.color[0], edge.color[1], edge.color[2]).into(),
                        width: edge.width,
                        ..Stroke::default()
                    }));
                    let mut lines = PathBuilder::new();
                    lines.move_to(x, origin.1);
                    lines.line_to(x, origin.1 + prepared.height);
                    lines.move_to(x + col.width, origin.1);
                    lines.line_to(x + col.width, origin.1 + prepared.height);
                    if row_idx - 1 == span.row {
                        lines.move_to(x, origin.1);
                        lines.line_to(x + col.width, origin.1);
                    }
                    if row_idx - 1 == span.row + span.row_span - 1 {
                        lines.move_to(x, origin.1 + prepared.height);
                        lines.line_to(x + col.width, origin.1 + prepared.height);
                    }
                    if let Some(path) = lines.finish() {
                        surface.draw_path(&path);
                    }
                }
            }
            surface.set_fill(old_fill);
            surface.set_stroke(old_stroke);
            x += col.width;
        }
        prepared.draw(row, surface, font, registry, origin, cancel)
    }
    /// Height of a page-local selection of the measured DFS leaves. Every
    /// active container contributes its own padding on this particular page.
    fn selection_height(&self, leaves: &[usize]) -> f32 {
        let mut sum = 2.0 * self.padding;
        for item in &self.items {
            let included = leaves
                .iter()
                .filter(|&&i| i >= item.flat_start && i < item.flat_end)
                .copied()
                .collect::<Vec<_>>();
            if included.is_empty() {
                continue;
            }
            if let PreparedContent::Box(nested, _) = &item.kind {
                let translated = included
                    .iter()
                    .map(|i| i - item.flat_start)
                    .collect::<Vec<_>>();
                sum += nested.selection_height(&translated);
            } else {
                sum += item.height;
            }
        }
        sum
    }

    /// Paint each occupied container fragment independently while retaining
    /// the same measured leaf order used by the flow paginator.
    #[allow(clippy::too_many_arguments)]
    fn draw_selected(
        &self,
        source: &PdfBox,
        surface: &mut Surface,
        font: &Font,
        registry: &FontRegistry,
        left: f32,
        top: f32,
        leaves: &[usize],
        original: std::ops::Range<usize>,
        cancel: &AtomicBool,
    ) -> Result<(), RenderError> {
        if leaves.is_empty()
            || original.start > original.end
            || original.end > self.item_heights.len()
        {
            return Err(RenderError::InvalidInput("invalid box fragment selection"));
        }
        let height = self.selection_height(leaves);
        let x = left + self.x;
        // A replayed table header is painted for context, not part of the
        // new original content: it cannot restore an enclosing top border.
        let has_original = original.start < original.end;
        let first = has_original && original.start == 0;
        let last = has_original && original.end == self.item_heights.len();
        if let Some(color) = self.background {
            if self.radius > 0.0 {
                rounded_background(
                    surface,
                    (x, top, self.width, height),
                    self.radius,
                    first,
                    last,
                    color,
                )?;
            } else {
                rect(surface, x, top, self.width, height, color)?;
            }
        }
        if let Some(color) = self.border_color.filter(|_| self.border_width > 0.0) {
            let b = self.border_width;
            if self.radius > 0.0 {
                rounded_border(
                    surface,
                    (x, top, self.width, height),
                    self.radius,
                    b,
                    first,
                    last,
                    color,
                )?;
            } else {
                rect(surface, x, top, b, height, color)?;
                rect(surface, x + self.width - b, top, b, height, color)?;
                if first {
                    rect(surface, x, top, self.width, b, color)?;
                }
                if last {
                    rect(surface, x, top + height - b, self.width, b, color)?;
                }
            }
        }
        let mut y = top + self.padding_top;
        for item in &self.items {
            check_cancel(cancel)?;
            let included = leaves
                .iter()
                .filter(|&&i| i >= item.flat_start && i < item.flat_end)
                .copied()
                .collect::<Vec<_>>();
            if included.is_empty() {
                continue;
            }
            if let PreparedContent::Box(nested, index) = &item.kind {
                let source_box = match &source.items[*index] {
                    PdfBoxItem::Box(b) => b,
                    _ => return Err(RenderError::InvalidInput("nested box source mismatch")),
                };
                let translated = included
                    .iter()
                    .map(|i| i - item.flat_start)
                    .collect::<Vec<_>>();
                // Translate real content boundaries independently of replayed
                // leaves, even when the table is nested several boxes deep.
                let child_start =
                    original.start.max(item.flat_start).min(item.flat_end) - item.flat_start;
                let child_end =
                    original.end.max(item.flat_start).min(item.flat_end) - item.flat_start;
                nested.draw_selected(
                    source_box,
                    surface,
                    font,
                    registry,
                    x + self.padding_left,
                    y,
                    &translated,
                    child_start..child_end,
                    cancel,
                )?;
                y += nested.selection_height(&translated);
                continue;
            }
            match &item.kind {
                PreparedContent::Text {
                    text,
                    size,
                    color,
                    before,
                    line_height,
                } => {
                    if !text.is_empty() {
                        let old_fill = surface.get_fill().cloned();
                        if let Some(c) = color {
                            use krilla::{color::rgb, paint::Fill};
                            surface.set_fill(Some(Fill {
                                paint: rgb::Color::new(c[0], c[1], c[2]).into(),
                                ..Fill::default()
                            }));
                        } else {
                            surface.set_fill(None);
                        }
                        surface.draw_text(
                            Point::from_xy(x + self.padding_left, y + before + line_height * 0.8),
                            font.clone(),
                            *size,
                            text,
                            false,
                            TextDirection::Auto,
                        );
                        surface.set_fill(old_fill);
                    }
                }
                PreparedContent::Rich {
                    line,
                    before,
                    line_height,
                } => {
                    let baseline = y + before + line_height * 0.8;
                    for run in line {
                        let old_fill = surface.get_fill().cloned();
                        if let Some(c) = run.color {
                            use krilla::{color::rgb, paint::Fill};
                            surface.set_fill(Some(Fill {
                                paint: rgb::Color::new(c[0], c[1], c[2]).into(),
                                ..Fill::default()
                            }));
                        } else {
                            surface.set_fill(None);
                        }
                        surface.draw_text(
                            Point::from_xy(x + self.padding_left + run.x, baseline),
                            registry.font(run.font_index),
                            run.font_size,
                            &run.text,
                            false,
                            TextDirection::Auto,
                        );
                        surface.set_fill(old_fill);
                    }
                }
                PreparedContent::Image(prepared, index) => {
                    if let PdfBoxItem::Image(img) = &source.items[*index] {
                        prepared.draw(surface, img.placement(), x + self.padding_left, y)?;
                    }
                }
                PreparedContent::Graphic(index) => {
                    if let PdfBoxItem::Graphic(g) = &source.items[*index] {
                        g.draw(surface, x + self.padding_left, y)?;
                    }
                }
                PreparedContent::SplitRow(prepared, source_row) => {
                    prepared.draw(
                        source_row,
                        surface,
                        font,
                        registry,
                        (x + self.padding_left, y),
                        cancel,
                    )?;
                }
                PreparedContent::Row(prepared, index) => {
                    if let PdfBoxItem::Row(r) = &source.items[*index] {
                        prepared.draw(
                            r,
                            surface,
                            font,
                            registry,
                            (x + self.padding_left, y),
                            cancel,
                        )?;
                    }
                }
                PreparedContent::TableRow(prepared, table_idx, row_idx) => {
                    self.draw_table_row(
                        source,
                        surface,
                        font,
                        registry,
                        (x + self.padding_left, y),
                        prepared,
                        *table_idx,
                        *row_idx,
                        None,
                        cancel,
                    )?;
                }
                PreparedContent::TableRowFragment(prepared, fragment, table_idx, row_idx) => {
                    self.draw_table_row(
                        source,
                        surface,
                        font,
                        registry,
                        (x + self.padding_left, y),
                        prepared,
                        *table_idx,
                        *row_idx,
                        Some(fragment),
                        cancel,
                    )?;
                }
                PreparedContent::Box(..) => unreachable!("box handled recursively"),
                PreparedContent::Spacer => {}
            }
            y += item.height;
        }
        Ok(())
    }
    pub fn draw(
        &self,
        source: &PdfBox,
        surface: &mut Surface,
        font: &Font,
        registry: &FontRegistry,
        pos: BoxFragmentPosition,
        cancel: &AtomicBool,
    ) -> Result<(), RenderError> {
        if pos.start >= pos.end || pos.end > self.item_heights.len() {
            return Err(RenderError::InvalidInput("invalid box fragment bounds"));
        }
        let mut leaves = Vec::with_capacity(pos.end - pos.start + 1);
        if let Some(header) = pos.repeat_header {
            if header >= pos.start || header >= self.item_heights.len() {
                return Err(RenderError::InvalidInput("invalid repeated table header"));
            }
            leaves.push(header);
        }
        leaves.extend(pos.start..pos.end);
        if (self.selection_height(&leaves) - pos.height).abs() > 0.1 {
            return Err(RenderError::InvalidInput(
                "box fragment height disagrees with paginator",
            ));
        }
        self.draw_selected(
            source,
            surface,
            font,
            registry,
            pos.left,
            pos.top,
            &leaves,
            pos.start..pos.end,
            cancel,
        )
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn box_example() -> PdfBox {
        PdfBox {
            width: None,
            align: BoxAlign::Left,
            padding: 12.0,
            padding_sides: None,
            min_height: None,
            max_height: None,
            space_between: false,
            border_width: 2.0,
            radius: 0.0,
            border_color: Some([12, 45, 200]),
            background: Some([240, 250, 255]),
            keep_together: false,
            break_before: false,
            keep_with_next: false,
            items: vec![PdfBoxItem::Text {
                text: "Example".into(),
                style: TextStyle::paragraph(),
                color: None,
            }],
        }
    }
    #[test]
    fn row_spans_verify_rectangles_and_continuation_is_empty() {
        let text = |v: &str| PdfRow {
            gap: 0.0,
            columns: vec![crate::PdfRowColumn {
                width: 180.0,
                right_align: false,
                cell: None,
                items: vec![crate::PdfRowItem::Text {
                    text: v.to_owned(),
                    style: TextStyle::paragraph(),
                }],
            }],
        };
        let blank = || PdfRow {
            gap: 0.0,
            columns: vec![crate::PdfRowColumn {
                width: 180.0,
                right_align: false,
                cell: None,
                items: vec![crate::PdfRowItem::Spacer(18.0)],
            }],
        };
        let mut table = PdfBoxTable {
            row_spans: vec![TableRowSpan {
                row: 0,
                column: 0,
                col_span: 1,
                row_span: 2,
            }],
            keep_with_next: vec![],
            header: text("HEADER"),
            rows: vec![text("CELL"), blank()],
            fills: vec![vec![None]; 3],
            borders: None,
        };
        assert!(table.validate(180.0, 600.0, 0).is_ok());
        table.rows[1] = text("FORGED_CONTINUATION");
        assert!(table.validate(180.0, 600.0, 0).is_err());
        table.rows[1] = blank();
        table.row_spans.push(TableRowSpan {
            row: 1,
            column: 0,
            col_span: 1,
            row_span: 2,
        });
        assert!(table.validate(180.0, 600.0, 0).is_err());
        table.row_spans.pop();
        table.row_spans.push(TableRowSpan {
            row: 0,
            column: 0,
            col_span: 1,
            row_span: 2,
        });
        assert!(table.validate(180.0, 600.0, 0).is_err());
    }
    #[test]
    fn table_group_keep_next_indices_are_bounded_ordered_and_require_a_successor() {
        let row = || PdfRow {
            gap: 0.0,
            columns: vec![crate::PdfRowColumn {
                width: 180.0,
                right_align: false,
                cell: None,
                items: vec![crate::PdfRowItem::Spacer(16.0)],
            }],
        };
        let mut table = PdfBoxTable {
            header: row(),
            rows: vec![row(), row(), row()],
            fills: vec![vec![None]; 4],
            borders: None,
            keep_with_next: vec![0, 1],
            row_spans: vec![],
        };
        assert!(table.validate(180.0, 600.0, 0).is_ok());
        table.keep_with_next = vec![1, 0];
        assert!(table.validate(180.0, 600.0, 0).is_err());
        table.keep_with_next = vec![0, 0];
        assert!(table.validate(180.0, 600.0, 0).is_err());
        table.keep_with_next = vec![2];
        assert!(table.validate(180.0, 600.0, 0).is_err());
    }
    #[test]
    fn bounded_nested_boxes_allow_eight_levels_and_reject_ninth() {
        let base = box_example();
        let mut current = base.clone();
        for depth in 0..10 {
            current = PdfBox {
                width: None,
                align: BoxAlign::Left,
                padding: 0.0,
                padding_sides: None,
                min_height: None,
                max_height: None,
                space_between: false,
                border_width: 0.0,
                radius: 0.0,
                border_color: None,
                background: None,
                keep_together: false,
                break_before: false,
                keep_with_next: false,
                items: vec![PdfBoxItem::Box(Box::new(current))],
            };
            let result = current.validate(497.0, 650.0);
            if depth <= 7 {
                assert!(result.is_ok(), "nested depth {depth}: {result:?}");
            } else {
                assert!(result.is_err(), "nested depth {depth} should reject");
            }
        }
    }
    #[test]
    fn alternating_box_row_layout_obeys_same_depth_limit() {
        fn wrapper(child: PdfBox) -> PdfBox {
            PdfBox {
                width: None,
                align: BoxAlign::Left,
                padding: 0.0,
                padding_sides: None,
                min_height: None,
                max_height: None,
                space_between: false,
                border_width: 0.0,
                radius: 0.0,
                border_color: None,
                background: None,
                keep_together: false,
                break_before: false,
                keep_with_next: false,
                items: vec![PdfBoxItem::Row(PdfRow {
                    gap: 0.0,
                    columns: vec![crate::PdfRowColumn {
                        width: 200.0,
                        right_align: false,
                        cell: None,
                        items: vec![crate::PdfRowItem::Box(Box::new(child))],
                    }],
                })],
            }
        }
        let mut value = box_example();
        for _ in 0..3 {
            value = wrapper(value);
        }
        assert!(value.validate(497.0, 650.0).is_ok());
        for _ in 0..2 {
            value = wrapper(value);
        }
        assert!(value.validate(497.0, 650.0).is_err());
    }
    #[test]
    fn rounded_box_requires_bounded_radius_and_sufficient_padding() {
        let mut b = box_example();
        b.padding = 16.0;
        b.radius = 12.0;
        assert!(b.validate(497.0, 650.0).is_ok());
        for radius in [-1.0, f32::INFINITY, f32::NAN, 25.0, 17.0] {
            b.radius = radius;
            assert!(
                b.validate(497.0, 650.0).is_err(),
                "invalid radius {radius} should be rejected"
            );
        }
        b.radius = 0.0;
        assert!(b.validate(497.0, 650.0).is_ok());
    }
    #[test]
    fn bad_geometry_is_rejected() {
        let base = box_example();
        assert!(base.validate(497.0, 650.0).is_ok());
        assert!(
            PdfBox {
                padding: 1.0,
                ..base.clone()
            }
            .validate(497.0, 650.0)
            .is_err()
        );
        assert!(
            PdfBox {
                width: Some(550.0),
                ..base.clone()
            }
            .validate(497.0, 650.0)
            .is_err()
        );
        assert!(
            PdfBox {
                items: vec![],
                ..base
            }
            .validate(497.0, 650.0)
            .is_err()
        );
    }
}
