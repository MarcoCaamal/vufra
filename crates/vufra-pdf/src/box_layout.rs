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
    Spacer(f32),
}
#[derive(Debug, Clone)]
pub struct PdfBox {
    pub width: Option<f32>,
    pub align: BoxAlign,
    pub padding: f32,
    pub border_width: f32,
    pub border_color: Option<[u8; 3]>,
    pub background: Option<[u8; 3]>,
    pub keep_together: bool,
    pub break_before: bool,
    pub keep_with_next: bool,
    pub items: Vec<PdfBoxItem>,
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
    Spacer,
}
struct PreparedItem {
    height: f32,
    kind: PreparedContent,
}
pub struct PreparedBox {
    pub item_heights: Vec<f32>,
    pub image_pixels: u64,
    width: f32,
    x: f32,
    padding: f32,
    border_width: f32,
    border_color: Option<[u8; 3]>,
    background: Option<[u8; 3]>,
    items: Vec<PreparedItem>,
}

impl PdfBox {
    pub fn validate(&self, width: f32, page_height: f32) -> Result<(), RenderError> {
        let w = self.width.unwrap_or(width);
        if !w.is_finite()
            || w < 100.0
            || w > width + 0.01
            || !self.padding.is_finite()
            || !(0.0..=60.0).contains(&self.padding)
            || !self.border_width.is_finite()
            || !(0.0..=6.0).contains(&self.border_width)
            || self.border_width > self.padding
            || w - 2.0 * self.padding < 60.0
            || self.padding * 2.0 + 1.0 > page_height
            || self.items.is_empty()
            || self.items.len() > 500
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
                    style.validate(page_height - 2.0 * self.padding)?;
                }
                PdfBoxItem::RichText { runs, style } => {
                    style.validate(page_height - 2.0 * self.padding)?;
                    if runs.is_empty() || runs.len() > 1_000 {
                        return Err(RenderError::InvalidInput("invalid box rich text runs"));
                    }
                }
                PdfBoxItem::Image(image) => {
                    image.validate_box(w - 2.0 * self.padding, page_height - 2.0 * self.padding)?
                }
                PdfBoxItem::Graphic(g) => {
                    g.validate(w - 2.0 * self.padding, page_height - 2.0 * self.padding)?
                }
                PdfBoxItem::Row(r) => {
                    r.validate_structure(w - 2.0 * self.padding, page_height - 2.0 * self.padding)?
                }
                PdfBoxItem::Spacer(h)
                    if !h.is_finite() || *h <= 0.0 || *h + 2.0 * self.padding > page_height =>
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
        let (page_width, page_height) = page;
        self.validate(page_width, page_height)?;
        let width = self.width.unwrap_or(page_width);
        let inner = width - 2.0 * self.padding;
        let x = match self.align {
            BoxAlign::Left => 0.0,
            BoxAlign::Center => (page_width - width) * 0.5,
            BoxAlign::Right => page_width - width,
        };
        let mut items = Vec::new();
        let mut pixels = 0u64;
        for (idx, item) in self.items.iter().enumerate() {
            check_cancel(cancel)?;
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
                        height: img.height,
                        kind: PreparedContent::Image(prepared, idx),
                    });
                }
                PdfBoxItem::Graphic(g) => items.push(PreparedItem {
                    height: g.height,
                    kind: PreparedContent::Graphic(idx),
                }),
                PdfBoxItem::Row(r) => {
                    let prepared = r.prepare(
                        (inner, page_height - 2.0 * self.padding),
                        family,
                        fonts,
                        context,
                        registry,
                        cancel,
                    )?;
                    pixels = pixels.saturating_add(prepared.image_pixels);
                    items.push(PreparedItem {
                        height: prepared.height,
                        kind: PreparedContent::Row(prepared, idx),
                    });
                }
                PdfBoxItem::Spacer(h) => items.push(PreparedItem {
                    height: *h,
                    kind: PreparedContent::Spacer,
                }),
            }
        }
        if items.len() > 10_000 {
            return Err(RenderError::InvalidInput("too many box text lines"));
        }
        let heights = items.iter().map(|i| i.height).collect();
        Ok(PreparedBox {
            item_heights: heights,
            image_pixels: pixels,
            width,
            x,
            padding: self.padding,
            border_width: self.border_width,
            border_color: self.border_color,
            background: self.background,
            items,
        })
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
pub struct BoxFragmentPosition {
    pub left: f32,
    pub top: f32,
    pub start: usize,
    pub end: usize,
    pub first: bool,
    pub last: bool,
    pub height: f32,
}
impl PreparedBox {
    pub fn draw(
        &self,
        source: &PdfBox,
        surface: &mut Surface,
        font: &Font,
        registry: &FontRegistry,
        pos: BoxFragmentPosition,
        cancel: &AtomicBool,
    ) -> Result<(), RenderError> {
        let BoxFragmentPosition {
            left,
            top,
            start,
            end,
            first,
            last,
            height,
        } = pos;
        let x = left + self.x;
        if let Some(color) = self.background {
            rect(surface, x, top, self.width, height, color)?;
        }
        if let Some(color) = self.border_color.filter(|_| self.border_width > 0.0) {
            let b = self.border_width;
            rect(surface, x, top, b, height, color)?;
            rect(surface, x + self.width - b, top, b, height, color)?;
            if first {
                rect(surface, x, top, self.width, b, color)?;
            }
            if last {
                rect(surface, x, top + height - b, self.width, b, color)?;
            }
        }
        let mut y = top + self.padding;
        for item in &self.items[start..end] {
            check_cancel(cancel)?;
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
                            Point::from_xy(x + self.padding, y + before + line_height * 0.8),
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
                            Point::from_xy(x + self.padding + run.x, baseline),
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
                        prepared.draw(surface, img, x + self.padding, y)?;
                    }
                }
                PreparedContent::Graphic(index) => {
                    if let PdfBoxItem::Graphic(g) = &source.items[*index] {
                        g.draw(surface, x + self.padding, y)?;
                    }
                }
                PreparedContent::Row(prepared, index) => {
                    if let PdfBoxItem::Row(r) = &source.items[*index] {
                        prepared.draw(r, surface, font, registry, (x + self.padding, y), cancel)?;
                    }
                }
                PreparedContent::Spacer => {}
            }
            y += item.height;
        }
        Ok(())
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
            border_width: 2.0,
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
