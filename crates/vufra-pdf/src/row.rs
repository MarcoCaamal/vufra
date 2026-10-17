//! Side-by-side row with text/image/graphics in independently measured columns.
//! Short rows stay atomic; overflowing rows use aligned item and text-line fragments.
use crate::box_layout::{BoxAlign, BoxFragmentPosition, PdfBox, PdfBoxItem, PreparedBox};
use crate::image::PreparedImage;
use crate::rich_text::{FontRegistry, RichLine, prepare_rich};
use crate::{
    PdfGraphic, PdfImage, PdfTextRun, RenderError, TextStyle, check_cancel, measure_text_lines,
};
use krilla::{
    geom::Point,
    surface::Surface,
    text::{Font, TextDirection},
};
use parley::{FontContext, FontFamily, FontFamilyName, Layout, LayoutContext, StyleProperty};
use std::sync::atomic::AtomicBool;
use std::{borrow::Cow, collections::VecDeque};

/// Internal shaped fragment: the original caller can never manufacture
/// cached font indices or skip the native rich-text input preflight.
#[derive(Debug, Clone)]
pub struct PreparedRichFragment {
    line: RichLine,
    style: TextStyle,
    line_height: f32,
}

#[derive(Debug, Clone)]
pub enum PdfRowItem {
    Text {
        text: String,
        style: TextStyle,
    },
    RichText {
        runs: Vec<PdfTextRun>,
        style: TextStyle,
    },
    /// Internal pre-shaped line produced during safe page fragmentation.
    /// Retains exact real font indices, sizes, colors and horizontal positions.
    #[doc(hidden)]
    MeasuredRichLine(PreparedRichFragment),
    Image(PdfImage),
    Box(Box<PdfBox>),
    Graphic(PdfGraphic),
    Spacer(f32),
}
#[derive(Debug, Clone)]
pub struct PdfRowColumn {
    pub width: f32,
    pub right_align: bool,
    pub items: Vec<PdfRowItem>,
}
#[derive(Debug, Clone)]
pub struct PdfRow {
    pub gap: f32,
    pub columns: Vec<PdfRowColumn>,
}
enum PreparedItemKind {
    Text {
        lines: Vec<String>,
        offsets: Vec<f32>,
        style: TextStyle,
    },
    Rich {
        lines: Vec<RichLine>,
        style: TextStyle,
        line_height: f32,
        offsets: Vec<f32>,
    },
    Image(PreparedImage),
    Box(Box<PreparedBox>),
    Graphic,
    Spacer,
}
struct PreparedItem {
    top: f32,
    kind: PreparedItemKind,
}
struct PreparedColumn {
    x: f32,
    width: f32,
    right_align: bool,
    items: Vec<PreparedItem>,
}
pub struct PreparedRow {
    pub height: f32,
    pub image_pixels: u64,
    columns: Vec<PreparedColumn>,
}

impl PdfRow {
    /// Divide a tall independently stacked row at synchronized item boundaries.
    /// Each segment keeps all column widths; longer columns continue on later
    /// pages while exhausted columns are empty. Plain text may split into lines.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn as_fragmentable_box(
        &self,
        family: &str,
        fonts: &mut FontContext,
        context: &mut LayoutContext<()>,
        registry: &mut FontRegistry,
        cancel: &AtomicBool,
    ) -> Result<PdfBox, RenderError> {
        // Shape ordinary text with the same Parley width used by the painter.
        // A long paragraph becomes independently page-breakable measured lines.
        // Mixed-font rich runs remain indivisible until line-range rich fragments
        // can preserve exact glyph/font registry information.
        let mut columns = Vec::new();
        for col in &self.columns {
            let mut expanded = Vec::new();
            for item in &col.items {
                check_cancel(cancel)?;
                match item {
                    PdfRowItem::Text { text, style } => {
                        let lines = measure_text_lines(
                            text,
                            col.width,
                            family,
                            fonts,
                            context,
                            style.font_size,
                            cancel,
                        )?;
                        let len = lines.len();
                        for (idx, line) in lines.into_iter().enumerate() {
                            let mut style = *style;
                            if idx > 0 {
                                style.space_before = 0.0;
                            }
                            if idx + 1 < len {
                                style.space_after = 0.0;
                            }
                            expanded.push(PdfRowItem::Text { text: line, style });
                        }
                    }
                    PdfRowItem::RichText { runs, style } => {
                        // Preserve the actual shaped faces and baseline metrics.
                        // Reconstructing PdfTextRun from lines would lose fallback
                        // glyph selection and color/font positioning.
                        let lines = prepare_rich(runs, *style, col.width, registry, cancel)?;
                        let largest = runs
                            .iter()
                            .map(|r| r.font_size.unwrap_or(style.font_size))
                            .fold(style.font_size, f32::max);
                        let line_height = style.line_height.max(largest * 1.35);
                        let len = lines.len();
                        for (idx, line) in lines.into_iter().enumerate() {
                            let mut part = *style;
                            if idx > 0 {
                                part.space_before = 0.0;
                            }
                            if idx + 1 < len {
                                part.space_after = 0.0;
                            }
                            expanded.push(PdfRowItem::MeasuredRichLine(PreparedRichFragment {
                                line,
                                style: part,
                                line_height,
                            }));
                        }
                    }
                    other => expanded.push(other.clone()),
                }
                if expanded.len() > 500 {
                    return Err(RenderError::InvalidInput(
                        "row text needs more than 500 line fragments",
                    ));
                }
            }
            columns.push(PdfRowColumn {
                width: col.width,
                right_align: col.right_align,
                items: expanded,
            });
        }
        Ok(Self::assemble_fragment_columns(self.gap, columns))
    }

    /// The synchronized rows own their fragments: never clone prepared rich
    /// lines or image payloads a second time after expanding a tall row.
    fn assemble_fragment_columns(gap: f32, columns: Vec<PdfRowColumn>) -> PdfBox {
        let mut queues = columns
            .into_iter()
            .map(|col| (col.width, col.right_align, VecDeque::from(col.items)))
            .collect::<Vec<_>>();
        let len = queues
            .iter()
            .map(|(_, _, items)| items.len())
            .max()
            .unwrap_or(0);
        let items = (0..len)
            .map(|_| {
                PdfBoxItem::Row(PdfRow {
                    gap,
                    columns: queues
                        .iter_mut()
                        .map(|(width, right_align, items)| PdfRowColumn {
                            width: *width,
                            right_align: *right_align,
                            items: items.pop_front().into_iter().collect(),
                        })
                        .collect(),
                })
            })
            .collect();
        PdfBox {
            width: None,
            align: BoxAlign::Left,
            padding: 0.0,
            border_width: 0.0,
            border_color: None,
            background: None,
            keep_together: false,
            break_before: false,
            keep_with_next: false,
            items,
        }
    }
    pub(crate) fn is_tall_row_error(error: &RenderError) -> bool {
        matches!(
            error,
            RenderError::InvalidInput(
                "row height exceeds printable page; split content into multiple rows"
            )
        )
    }
    pub fn validate_structure(
        &self,
        content_width: f32,
        page_height: f32,
    ) -> Result<(), RenderError> {
        self.validate_depth(content_width, page_height, 0)
    }
    pub(crate) fn validate_depth(
        &self,
        content_width: f32,
        page_height: f32,
        depth: usize,
    ) -> Result<(), RenderError> {
        if depth > 8 {
            return Err(RenderError::InvalidInput("nested layout depth exceeds 8"));
        }
        if self.columns.is_empty()
            || self.columns.len() > 6
            || !self.gap.is_finite()
            || !(0.0..=80.0).contains(&self.gap)
        {
            return Err(RenderError::InvalidInput(
                "row requires 1..6 columns and a valid gap",
            ));
        }
        let mut sum = self.gap * (self.columns.len() - 1) as f32;
        for col in &self.columns {
            if !col.width.is_finite() || col.width < 60.0 || col.items.len() > 50 {
                return Err(RenderError::InvalidInput(
                    "row column requires width >= 60 and <=50 items",
                ));
            }
            sum += col.width;
            for item in &col.items {
                match item {
                    PdfRowItem::Text { text, style } => {
                        if text.contains('\0') {
                            return Err(RenderError::InvalidInput("invalid row text"));
                        }
                        style.validate(page_height)?;
                    }
                    PdfRowItem::RichText { runs, style } => {
                        style.validate(page_height)?;
                        if runs.is_empty() || runs.len() > 1_000 {
                            return Err(RenderError::InvalidInput("invalid row rich text runs"));
                        }
                    }
                    PdfRowItem::MeasuredRichLine(PreparedRichFragment {
                        line,
                        style,
                        line_height,
                    }) => {
                        style.validate(page_height)?;
                        if line.is_empty()
                            || !line_height.is_finite()
                            || *line_height <= 0.0
                            || *line_height > page_height
                        {
                            return Err(RenderError::InvalidInput("invalid measured rich line"));
                        }
                    }
                    PdfRowItem::Image(img) => img.validate_box(col.width, page_height)?,
                    PdfRowItem::Box(boxed) => {
                        boxed.validate_depth(col.width, page_height, depth + 1)?
                    }
                    PdfRowItem::Graphic(g) => g.validate(col.width, page_height)?,
                    PdfRowItem::Spacer(h) if !h.is_finite() || *h <= 0.0 || *h > page_height => {
                        return Err(RenderError::InvalidInput("invalid row spacer"));
                    }
                    PdfRowItem::Spacer(_) => {}
                }
            }
        }
        if sum > content_width + 0.02 {
            return Err(RenderError::InvalidInput(
                "row columns exceed printable width",
            ));
        }
        Ok(())
    }
    pub fn prepare(
        &self,
        printable_area: (f32, f32),
        family: &str,
        fonts: &mut FontContext,
        context: &mut LayoutContext<()>,
        registry: &mut FontRegistry,
        cancel: &AtomicBool,
    ) -> Result<PreparedRow, RenderError> {
        self.prepare_depth(printable_area, family, fonts, context, registry, cancel, 0)
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare_depth(
        &self,
        printable_area: (f32, f32),
        family: &str,
        fonts: &mut FontContext,
        context: &mut LayoutContext<()>,
        registry: &mut FontRegistry,
        cancel: &AtomicBool,
        depth: usize,
    ) -> Result<PreparedRow, RenderError> {
        let (printable_width, printable_height) = printable_area;
        self.validate_depth(printable_width, printable_height, depth)?;
        let mut result = Vec::new();
        let mut x = 0.0;
        let mut total_height = 0.0_f32;
        let mut image_pixels = 0_u64;
        for col in &self.columns {
            check_cancel(cancel)?;
            let mut items = Vec::new();
            let mut y = 0.0;
            for item in &col.items {
                check_cancel(cancel)?;
                let (height, kind) = match item {
                    PdfRowItem::Text { text, style } => {
                        let lines = measure_text_lines(
                            text,
                            col.width,
                            family,
                            fonts,
                            context,
                            style.font_size,
                            cancel,
                        )?;
                        let offsets = if col.right_align {
                            let mut positions = Vec::new();
                            for line in &lines {
                                let advance =
                                    line_width(line, style.font_size, family, fonts, context)?;
                                positions.push((col.width - advance).max(0.0));
                            }
                            positions
                        } else {
                            vec![0.0; lines.len()]
                        };
                        let h = style.space_before
                            + lines.len() as f32 * style.line_height
                            + style.space_after;
                        (
                            h,
                            PreparedItemKind::Text {
                                lines,
                                offsets,
                                style: *style,
                            },
                        )
                    }
                    PdfRowItem::RichText { runs, style } => {
                        let lines = prepare_rich(runs, *style, col.width, registry, cancel)?;
                        let largest = runs
                            .iter()
                            .map(|r| r.font_size.unwrap_or(style.font_size))
                            .fold(style.font_size, f32::max);
                        let line_height = style.line_height.max(largest * 1.35);
                        let offsets = if col.right_align {
                            lines
                                .iter()
                                .map(|line| {
                                    registry.line_width(line).map(|w| (col.width - w).max(0.0))
                                })
                                .collect::<Result<Vec<_>, _>>()?
                        } else {
                            vec![0.0; lines.len()]
                        };
                        let h = style.space_before
                            + lines.len() as f32 * line_height
                            + style.space_after;
                        (
                            h,
                            PreparedItemKind::Rich {
                                lines,
                                style: *style,
                                line_height,
                                offsets,
                            },
                        )
                    }
                    PdfRowItem::MeasuredRichLine(PreparedRichFragment {
                        line,
                        style,
                        line_height,
                    }) => {
                        let offset = if col.right_align {
                            (col.width - registry.line_width(line)?).max(0.0)
                        } else {
                            0.0
                        };
                        (
                            style.space_before + line_height + style.space_after,
                            PreparedItemKind::Rich {
                                lines: vec![line.clone()],
                                style: *style,
                                line_height: *line_height,
                                offsets: vec![offset],
                            },
                        )
                    }
                    PdfRowItem::Image(image) => {
                        let bitmap = image.prepare()?;
                        image_pixels = image_pixels.saturating_add(bitmap.pixel_count());
                        (image.height, PreparedItemKind::Image(bitmap))
                    }
                    PdfRowItem::Box(boxed) => {
                        let prepared = boxed.prepare_depth(
                            (col.width, printable_height),
                            family,
                            fonts,
                            context,
                            registry,
                            cancel,
                            depth + 1,
                        )?;
                        let height = prepared.total_height();
                        image_pixels = image_pixels.saturating_add(prepared.image_pixels);
                        (height, PreparedItemKind::Box(Box::new(prepared)))
                    }
                    PdfRowItem::Graphic(g) => (g.height, PreparedItemKind::Graphic),
                    PdfRowItem::Spacer(h) => (*h, PreparedItemKind::Spacer),
                };
                items.push(PreparedItem { top: y, kind });
                y += height;
                if y > printable_height + 0.001 {
                    return Err(RenderError::InvalidInput(
                        "row height exceeds printable page; split content into multiple rows",
                    ));
                }
            }
            total_height = total_height.max(y);
            result.push(PreparedColumn {
                x,
                width: col.width,
                right_align: col.right_align,
                items,
            });
            x += col.width + self.gap;
        }
        if total_height < 0.001 {
            return Err(RenderError::InvalidInput(
                "row needs at least one visible item",
            ));
        }
        Ok(PreparedRow {
            height: total_height,
            image_pixels,
            columns: result,
        })
    }
}
impl PreparedRow {
    pub fn draw(
        &self,
        row: &PdfRow,
        surface: &mut Surface,
        font: &Font,
        registry: &FontRegistry,
        origin: (f32, f32),
        cancel: &AtomicBool,
    ) -> Result<(), RenderError> {
        let (left, top) = origin;
        for (col_idx, col) in self.columns.iter().enumerate() {
            for (item_idx, item) in col.items.iter().enumerate() {
                check_cancel(cancel)?;
                let position_y = top + item.top;
                match &item.kind {
                    PreparedItemKind::Text {
                        lines,
                        offsets,
                        style,
                    } => {
                        // Per-line offsets are measured by Parley with this actual font.
                        for (i, line) in lines.iter().enumerate() {
                            if line.is_empty() {
                                continue;
                            }
                            let pos_x = left + col.x + offsets[i];
                            surface.draw_text(
                                Point::from_xy(
                                    pos_x,
                                    position_y
                                        + style.space_before
                                        + (i as f32 + 0.8) * style.line_height,
                                ),
                                font.clone(),
                                style.font_size,
                                line,
                                false,
                                TextDirection::Auto,
                            );
                        }
                    }
                    PreparedItemKind::Rich {
                        lines,
                        style,
                        line_height,
                        offsets,
                    } => {
                        for (i, line) in lines.iter().enumerate() {
                            let baseline =
                                position_y + style.space_before + (i as f32 + 0.8) * line_height;
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
                                    Point::from_xy(left + col.x + offsets[i] + run.x, baseline),
                                    registry.font(run.font_index),
                                    run.font_size,
                                    &run.text,
                                    false,
                                    TextDirection::Auto,
                                );
                                surface.set_fill(old_fill);
                            }
                        }
                    }
                    PreparedItemKind::Image(prepared) => {
                        if let PdfRowItem::Image(source) = &row.columns[col_idx].items[item_idx] {
                            let x = if col.right_align {
                                left + col.x + col.width - source.width
                            } else {
                                left + col.x
                            };
                            prepared.draw(surface, source, x, position_y)?;
                        }
                    }
                    PreparedItemKind::Box(prepared) => {
                        if let PdfRowItem::Box(original) = &row.columns[col_idx].items[item_idx] {
                            prepared.draw(
                                original,
                                surface,
                                font,
                                registry,
                                BoxFragmentPosition {
                                    left: left + col.x,
                                    top: position_y,
                                    start: 0,
                                    end: prepared.item_heights.len(),
                                    repeat_header: None,
                                    first: true,
                                    last: true,
                                    height: prepared.total_height(),
                                },
                                cancel,
                            )?;
                        }
                    }
                    PreparedItemKind::Graphic => {
                        if let PdfRowItem::Graphic(g) = &row.columns[col_idx].items[item_idx] {
                            let x = if col.right_align {
                                left + col.x + col.width - g.width
                            } else {
                                left + col.x
                            };
                            g.draw(surface, x, position_y)?;
                        }
                    }
                    PreparedItemKind::Spacer => {}
                }
            }
        }
        Ok(())
    }
}

fn line_width(
    text: &str,
    size: f32,
    family: &str,
    fonts: &mut FontContext,
    context: &mut LayoutContext<()>,
) -> Result<f32, RenderError> {
    if text.trim().is_empty() {
        return Ok(0.0);
    }
    let mut builder = context.ranged_builder(fonts, text, 1.0, false);
    builder.push_default(StyleProperty::FontSize(size));
    builder.push_default(StyleProperty::FontFamily(FontFamily::Single(
        FontFamilyName::Named(Cow::Owned(family.to_string())),
    )));
    let mut layout: Layout<()> = builder.build(text);
    layout.break_all_lines(None);
    Ok(layout.width())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn synchronized_fragments_move_images_and_rich_runs_without_cloning() {
        let image_bytes = vec![4u8; 96 * 1024];
        let image_address = image_bytes.as_ptr();
        let rich_text = "SHAPED_BOLD_FRAGMENT".repeat(2000);
        let rich_address = rich_text.as_ptr();
        let rich = PdfRowItem::MeasuredRichLine(PreparedRichFragment {
            line: vec![crate::rich_text::PositionedRun {
                text: rich_text,
                x: 12.0,
                font_index: 1,
                font_size: 13.0,
                color: Some([17, 34, 51]),
            }],
            style: TextStyle::paragraph(),
            line_height: 18.0,
        });
        let fragments = PdfRow::assemble_fragment_columns(
            9.0,
            vec![
                PdfRowColumn {
                    width: 190.0,
                    right_align: false,
                    items: vec![
                        PdfRowItem::Image(PdfImage {
                            data: image_bytes,
                            width: 40.0,
                            height: 40.0,
                            fit: crate::ImageFit::Contain,
                        }),
                        rich,
                        PdfRowItem::Spacer(7.0),
                    ],
                },
                PdfRowColumn {
                    width: 170.0,
                    right_align: true,
                    items: vec![PdfRowItem::Spacer(5.0)],
                },
            ],
        );
        assert_eq!(fragments.items.len(), 3);
        let PdfBoxItem::Row(first) = &fragments.items[0] else {
            panic!("first synchronized row");
        };
        assert_eq!(first.gap, 9.0);
        assert!(first.columns[1].right_align);
        let PdfRowItem::Image(image) = &first.columns[0].items[0] else {
            panic!("image must remain first");
        };
        assert_eq!(image.data.as_ptr(), image_address);
        let PdfBoxItem::Row(second) = &fragments.items[1] else {
            panic!("second synchronized row");
        };
        assert!(second.columns[1].items.is_empty());
        let PdfRowItem::MeasuredRichLine(shaped) = &second.columns[0].items[0] else {
            panic!("measured rich line must remain second");
        };
        assert_eq!(shaped.line[0].text.as_ptr(), rich_address);
        assert_eq!(shaped.line[0].font_index, 1);
        assert_eq!(shaped.line[0].color, Some([17, 34, 51]));
        let PdfBoxItem::Row(last) = &fragments.items[2] else {
            panic!("third synchronized row");
        };
        assert!(matches!(
            last.columns[0].items.as_slice(),
            [PdfRowItem::Spacer(7.0)]
        ));
    }
    #[test]
    fn columns_validate_width_and_page_constraints() {
        let row = PdfRow {
            gap: 12.0,
            columns: vec![
                PdfRowColumn {
                    width: 230.0,
                    right_align: false,
                    items: vec![PdfRowItem::Text {
                        text: "Company".into(),
                        style: TextStyle::paragraph(),
                    }],
                },
                PdfRowColumn {
                    width: 255.0,
                    right_align: true,
                    items: vec![PdfRowItem::Spacer(12.0)],
                },
            ],
        };
        assert!(row.validate_structure(497.0, 650.0).is_ok());
        assert!(row.validate_structure(480.0, 650.0).is_err());
        assert!(
            PdfRow {
                gap: f32::INFINITY,
                ..row.clone()
            }
            .validate_structure(497.0, 650.0)
            .is_err()
        );
        assert!(
            PdfRow {
                gap: 12.0,
                columns: vec![PdfRowColumn {
                    width: 50.0,
                    right_align: false,
                    items: vec![]
                }]
            }
            .validate_structure(497.0, 650.0)
            .is_err()
        );
        assert!(
            PdfRow {
                gap: 12.0,
                columns: vec![PdfRowColumn {
                    width: 230.0,
                    right_align: false,
                    items: vec![PdfRowItem::Spacer(700.0)]
                }]
            }
            .validate_structure(497.0, 650.0)
            .is_err()
        );
    }
}
