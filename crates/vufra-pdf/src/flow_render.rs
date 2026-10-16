//! Rendering of ordered, styled blocks with configurable page geometry.
use super::{
    MAX_FONT_BYTES, MAX_TOTAL_TEXT_BYTES, PageGeometry, PdfBlock, RenderError, RenderOptions,
    TextStyle, draw_table_fragment, measure_text_lines, prepare_table,
};
use krilla::{
    Document as KrillaDocument,
    geom::Point,
    page::PageSettings,
    text::{Font, TextDirection},
};
use parley::{
    FontContext, FontFamily, FontFamilyName, Layout, LayoutContext, StyleProperty,
    fontique::{Blob, Collection, CollectionOptions, SourceCache},
};
use std::{borrow::Cow, sync::Arc};
use vufra_layout::flow::{FlowBlock, FlowFragment, paginate_flow};

enum PreparedBlock {
    Text {
        lines: Vec<String>,
        style: TextStyle,
    },
    Table(super::table::PreparedTable),
    Spacer,
}

fn validate_flow(title: &str, blocks: &[PdfBlock], font: &[u8]) -> Result<(), RenderError> {
    if title.trim().is_empty() || title.contains('\0') {
        return Err(RenderError::InvalidInput(
            "title must be nonempty and contain no nulls",
        ));
    }
    if font.is_empty() || font.len() > MAX_FONT_BYTES {
        return Err(RenderError::InvalidFont);
    }
    if blocks.len() > 2_000 {
        return Err(RenderError::InvalidInput("too many content blocks"));
    }
    let mut total = title.len();
    let mut rows = 0usize;
    for block in blocks {
        match block {
            PdfBlock::Paragraph(s)
            | PdfBlock::Heading { text: s, .. }
            | PdfBlock::StyledParagraph { text: s, .. } => {
                total = total
                    .checked_add(s.len())
                    .ok_or(RenderError::InvalidInput("text too large"))?;
            }
            PdfBlock::Spacer { height } => {
                if !height.is_finite() || *height <= 0.0 {
                    return Err(RenderError::InvalidInput("invalid spacer height"));
                }
            }
            PdfBlock::Table(table) => {
                rows = rows
                    .checked_add(table.rows.len())
                    .ok_or(RenderError::InvalidInput("too many rows"))?;
                for column in &table.columns {
                    total = total
                        .checked_add(column.header.len())
                        .ok_or(RenderError::InvalidInput("text too large"))?;
                }
                for cells in &table.rows {
                    for cell in cells {
                        total = total
                            .checked_add(cell.len())
                            .ok_or(RenderError::InvalidInput("text too large"))?;
                    }
                }
            }
        }
        if total > MAX_TOTAL_TEXT_BYTES || rows > 10_000 {
            return Err(RenderError::InvalidInput("too many rows or too much text"));
        }
    }
    Ok(())
}

pub(super) fn render_flow(
    title: &str,
    blocks: &[PdfBlock],
    font_bytes: &[u8],
    options: RenderOptions,
    geometry: PageGeometry,
) -> Result<Vec<u8>, RenderError> {
    geometry.validate()?;
    validate_flow(title, blocks, font_bytes)?;
    let font = Font::new(font_bytes.to_vec().into(), 0).ok_or(RenderError::InvalidFont)?;
    let mut fonts = FontContext {
        collection: Collection::new(CollectionOptions {
            shared: false,
            system_fonts: false,
        }),
        source_cache: SourceCache::default(),
    };
    let registered = fonts
        .collection
        .register_fonts(Blob::new(Arc::new(font_bytes.to_vec())), None);
    let id = registered.first().ok_or(RenderError::InvalidFont)?.0;
    let family = fonts
        .collection
        .family_name(id)
        .ok_or(RenderError::InvalidFont)?
        .to_string();
    let mut context: LayoutContext<()> = LayoutContext::new();
    let mut title_builder = context.ranged_builder(&mut fonts, title, 1.0, false);
    title_builder.push_default(StyleProperty::FontSize(18.0));
    title_builder.push_default(StyleProperty::FontFamily(FontFamily::Single(
        FontFamilyName::Named(Cow::Owned(family.clone())),
    )));
    let mut title_layout: Layout<()> = title_builder.build(title);
    title_layout.break_all_lines(None);
    if title_layout.width() > geometry.content_width() {
        return Err(RenderError::InvalidInput("title exceeds printable width"));
    }

    let mut prepared = Vec::with_capacity(blocks.len());
    let mut measurements = Vec::with_capacity(blocks.len());
    for block in blocks {
        match block {
            PdfBlock::Paragraph(text)
            | PdfBlock::Heading { text, .. }
            | PdfBlock::StyledParagraph { text, .. } => {
                let style = match block {
                    PdfBlock::Heading { level, .. } => TextStyle::heading(*level)?,
                    PdfBlock::StyledParagraph { style, .. } => *style,
                    _ => TextStyle {
                        font_size: options.text_size,
                        line_height: options.line_height,
                        space_before: options.text_size + 6.0,
                        space_after: 9.0,
                    },
                };
                style.validate(geometry.content_height())?;
                let lines = measure_text_lines(
                    text,
                    geometry.content_width(),
                    &family,
                    &mut fonts,
                    &mut context,
                    style.font_size,
                )?;
                measurements.push(FlowBlock::Paragraph {
                    lines: lines.len(),
                    line_height: style.line_height,
                    padding_before: style.space_before,
                    spacing_after: style.space_after,
                });
                prepared.push(PreparedBlock::Text { lines, style });
            }
            PdfBlock::Spacer { height } => {
                measurements.push(FlowBlock::Spacer { height: *height });
                prepared.push(PreparedBlock::Spacer);
            }
            PdfBlock::Table(table) => {
                let layout = prepare_table(
                    table,
                    &family,
                    &mut fonts,
                    &mut context,
                    options,
                    geometry.content_width(),
                    geometry.content_height(),
                )?;
                measurements.push(FlowBlock::Table {
                    line_counts: layout.rows.iter().map(|r| r.line_count).collect(),
                    header_height: layout.header_height,
                    line_height: options.line_height,
                    padding: 6.0,
                });
                prepared.push(PreparedBlock::Table(layout));
            }
        }
    }
    let pages = paginate_flow(&measurements, geometry.content_height())
        .map_err(RenderError::InvalidLayout)?;
    let mut output = KrillaDocument::new();
    for (index, plan) in pages.iter().enumerate() {
        let settings = PageSettings::from_wh(geometry.width, geometry.height)
            .ok_or(RenderError::InvalidInput("invalid paper size"))?;
        let mut page = output.start_page_with(settings);
        let mut surface = page.surface();
        let left = geometry.margin_left;
        surface.draw_text(
            Point::from_xy(left, geometry.margin_top - 69.0),
            font.clone(),
            18.0,
            title,
            false,
            TextDirection::Auto,
        );
        surface.draw_text(
            Point::from_xy(left, geometry.margin_top - 33.0),
            font.clone(),
            10.0,
            "Vufra • Documento generado desde Rust",
            false,
            TextDirection::Auto,
        );
        surface.draw_text(
            Point::from_xy(left, geometry.height - geometry.margin_bottom * 0.4),
            font.clone(),
            10.0,
            &format!("Página {} / {}", index + 1, pages.len()),
            false,
            TextDirection::Auto,
        );
        let mut y = geometry.margin_top;
        for fragment in &plan.fragments {
            match fragment {
                FlowFragment::Spacer { height, .. } => y += height,
                FlowFragment::Paragraph {
                    block,
                    start_line,
                    end_line,
                    height,
                    padding_before,
                } => {
                    if let PreparedBlock::Text { lines, style } = &prepared[*block] {
                        for (local, line) in lines[*start_line..*end_line].iter().enumerate() {
                            if !line.is_empty() {
                                surface.draw_text(
                                    Point::from_xy(
                                        left,
                                        y + padding_before + local as f32 * style.line_height,
                                    ),
                                    font.clone(),
                                    style.font_size,
                                    line,
                                    false,
                                    TextDirection::Auto,
                                );
                            }
                        }
                    }
                    y += height;
                }
                FlowFragment::Table { block, page } => {
                    if let PreparedBlock::Table(table) = &prepared[*block] {
                        draw_table_fragment(&mut surface, table, page, &font, options, y, left);
                    }
                    y += page.used_height;
                }
            }
        }
        surface.finish();
        page.finish();
    }
    output
        .finish()
        .map_err(|e| RenderError::InvalidPdf(format!("{e:?}")))
}
