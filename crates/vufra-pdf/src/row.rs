//! Side-by-side row with text/image/graphics in independently measured columns.
//! Unit 14: deliberately atomic across pages, unlike paginated main-flow tables.
use crate::image::PreparedImage;
use crate::{PdfGraphic, PdfImage, RenderError, TextStyle, check_cancel, measure_text_lines};
use krilla::{
    geom::Point,
    surface::Surface,
    text::{Font, TextDirection},
};
use parley::{FontContext, FontFamily, FontFamilyName, Layout, LayoutContext, StyleProperty};
use std::borrow::Cow;
use std::sync::atomic::AtomicBool;

#[derive(Debug, Clone)]
pub enum PdfRowItem {
    Text { text: String, style: TextStyle },
    Image(PdfImage),
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
    Image(PreparedImage),
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
    pub fn validate_structure(
        &self,
        content_width: f32,
        page_height: f32,
    ) -> Result<(), RenderError> {
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
                    PdfRowItem::Image(img) => img.validate_box(col.width, page_height)?,
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
        printable_width: f32,
        printable_height: f32,
        family: &str,
        fonts: &mut FontContext,
        context: &mut LayoutContext<()>,
        cancel: &AtomicBool,
    ) -> Result<PreparedRow, RenderError> {
        self.validate_structure(printable_width, printable_height)?;
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
                    PdfRowItem::Image(image) => {
                        let bitmap = image.prepare()?;
                        image_pixels = image_pixels.saturating_add(bitmap.pixel_count());
                        (image.height, PreparedItemKind::Image(bitmap))
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
        left: f32,
        top: f32,
        cancel: &AtomicBool,
    ) -> Result<(), RenderError> {
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
