//! Rendering of ordered, styled blocks with configurable page geometry.
use super::check_cancel;
use super::{
    MAX_FONT_BYTES, MAX_TOTAL_TEXT_BYTES, PageGeometry, PdfBlock, RenderError, RenderOptions,
    TextStyle, draw_table_fragment,
    image::{MAX_IMAGE_BLOCKS, MAX_TOTAL_IMAGE_BYTES, MAX_TOTAL_IMAGE_PIXELS, PreparedImage},
    measure_text_lines, prepare_table,
    rich_text::{FontRegistry, PdfFontFace, RichLine, prepare_rich},
};
use krilla::{
    Document as KrillaDocument,
    color::rgb,
    geom::Point,
    page::PageSettings,
    paint::Fill,
    text::{Font, TextDirection},
};
use parley::{
    FontContext, FontFamily, FontFamilyName, Layout, LayoutContext, StyleProperty,
    fontique::{Blob, Collection, CollectionOptions, SourceCache},
};
use std::{
    borrow::Cow,
    sync::{Arc, atomic::AtomicBool},
};
use vufra_layout::flow::{FlowBlock, FlowFragment, paginate_flow_with_keep};

enum PreparedBlock {
    Text {
        lines: Vec<String>,
        style: TextStyle,
    },
    Table(super::table::PreparedTable),
    Spacer,
    Image(PreparedImage),
    Graphic,
    Row(super::row::PreparedRow),
    Box(super::box_layout::PreparedBox),
    Rich {
        lines: Vec<RichLine>,
        line_height: f32,
    },
    List {
        lines: Vec<(String, Option<String>)>,
        style: TextStyle,
    },
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
    let mut image_bytes = 0usize;
    let mut image_count = 0usize;
    for block in blocks {
        match block {
            PdfBlock::Paragraph(s)
            | PdfBlock::Heading { text: s, .. }
            | PdfBlock::StyledParagraph { text: s, .. } => {
                total = total
                    .checked_add(s.len())
                    .ok_or(RenderError::InvalidInput("text too large"))?;
            }
            PdfBlock::RichParagraph { runs, .. } => {
                if runs.is_empty() || runs.len() > 1_000 {
                    return Err(RenderError::InvalidInput(
                        "rich paragraph requires 1..1000 runs",
                    ));
                }
                for run in runs {
                    total = total
                        .checked_add(run.text.len())
                        .ok_or(RenderError::InvalidInput("text too large"))?;
                }
            }
            PdfBlock::List { items, .. } => {
                if items.is_empty()
                    || items.len() > 1_000
                    || items
                        .iter()
                        .any(|s| s.trim().is_empty() || s.contains('\0'))
                {
                    return Err(RenderError::InvalidInput(
                        "list requires 1..1000 nonempty items",
                    ));
                }
                for item in items {
                    total = total
                        .checked_add(item.len())
                        .ok_or(RenderError::InvalidInput("text too large"))?;
                }
            }
            PdfBlock::Box(boxed) => {
                if boxed.items.len() > 500 {
                    return Err(RenderError::InvalidInput("too many box items"));
                }
                for item in &boxed.items {
                    match item {
                        super::PdfBoxItem::Text { text, .. } => {
                            total = total
                                .checked_add(text.len())
                                .ok_or(RenderError::InvalidInput("text too large"))?;
                        }
                        super::PdfBoxItem::Image(img) => {
                            image_count += 1;
                            image_bytes = image_bytes
                                .checked_add(img.data.len())
                                .ok_or(RenderError::InvalidInput("too much image data"))?;
                        }
                        super::PdfBoxItem::Row(row) => {
                            for column in &row.columns {
                                for nested in &column.items {
                                    match nested {
                                        super::row::PdfRowItem::Text { text, .. } => {
                                            total = total.checked_add(text.len()).ok_or(
                                                RenderError::InvalidInput("text too large"),
                                            )?;
                                        }
                                        super::row::PdfRowItem::Image(img) => {
                                            image_count += 1;
                                            image_bytes = image_bytes
                                                .checked_add(img.data.len())
                                                .ok_or(RenderError::InvalidInput(
                                                "too much image data",
                                            ))?;
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
                if image_count > MAX_IMAGE_BLOCKS || image_bytes > MAX_TOTAL_IMAGE_BYTES {
                    return Err(RenderError::InvalidInput("too many images or image bytes"));
                }
            }
            PdfBlock::Row(row) => {
                row.validate_structure(2000.0, 2000.0)?;
                for col in &row.columns {
                    for item in &col.items {
                        match item {
                            super::row::PdfRowItem::Text { text, .. } => {
                                total = total
                                    .checked_add(text.len())
                                    .ok_or(RenderError::InvalidInput("text too large"))?;
                            }
                            super::row::PdfRowItem::Image(image) => {
                                image_count += 1;
                                image_bytes = image_bytes
                                    .checked_add(image.data.len())
                                    .ok_or(RenderError::InvalidInput("too much image data"))?;
                            }
                            _ => {}
                        }
                    }
                }
                if image_count > MAX_IMAGE_BLOCKS || image_bytes > MAX_TOTAL_IMAGE_BYTES {
                    return Err(RenderError::InvalidInput("too many images or image bytes"));
                }
            }
            PdfBlock::Graphic(_) | PdfBlock::PageBreak => {}
            PdfBlock::Image(image) => {
                image_count += 1;
                image_bytes = image_bytes
                    .checked_add(image.data.len())
                    .ok_or(RenderError::InvalidInput("too much image data"))?;
                if image_count > MAX_IMAGE_BLOCKS || image_bytes > MAX_TOTAL_IMAGE_BYTES {
                    return Err(RenderError::InvalidInput("too many images or image bytes"));
                }
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
    extra_fonts: &[PdfFontFace],
    cancel: &AtomicBool,
) -> Result<Vec<u8>, RenderError> {
    check_cancel(cancel)?;
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

    // Do not allocate duplicate font contexts for documents without rich text.
    let mut font_registry = if !extra_fonts.is_empty()
        || blocks
            .iter()
            .any(|b| matches!(b, PdfBlock::RichParagraph { .. }))
    {
        Some(FontRegistry::new(font_bytes, extra_fonts)?)
    } else {
        None
    };
    let mut prepared = Vec::with_capacity(blocks.len());
    let mut measurements = Vec::with_capacity(blocks.len());
    let mut total_image_pixels = 0u64;
    for block in blocks {
        check_cancel(cancel)?;
        match block {
            PdfBlock::Box(boxed) => {
                let prepared_box = boxed.prepare(
                    geometry.content_width(),
                    geometry.content_height(),
                    &family,
                    &mut fonts,
                    &mut context,
                    cancel,
                )?;
                total_image_pixels = total_image_pixels.saturating_add(prepared_box.image_pixels);
                if total_image_pixels > MAX_TOTAL_IMAGE_PIXELS {
                    return Err(RenderError::InvalidInput(
                        "total image pixel budget exceeded",
                    ));
                }
                measurements.push(FlowBlock::Box {
                    item_heights: prepared_box.item_heights.clone(),
                    padding: boxed.padding,
                });
                prepared.push(PreparedBlock::Box(prepared_box));
            }
            PdfBlock::PageBreak => {
                measurements.push(FlowBlock::PageBreak);
                prepared.push(PreparedBlock::Spacer);
            }
            PdfBlock::RichParagraph { runs, style, .. } => {
                style.validate(geometry.content_height())?;
                let lines = prepare_rich(
                    runs,
                    *style,
                    geometry.content_width(),
                    font_registry.as_mut().expect("rich paragraph has registry"),
                    cancel,
                )?;
                // The flow planner uses fixed line heights for a paragraph.
                // Reserve enough vertical space for its largest inline font.
                let largest = runs
                    .iter()
                    .map(|r| r.font_size.unwrap_or(style.font_size))
                    .fold(style.font_size, f32::max);
                let line_height = style.line_height.max(largest * 1.35);
                measurements.push(FlowBlock::Paragraph {
                    lines: lines.len(),
                    line_height,
                    padding_before: style.space_before,
                    spacing_after: style.space_after,
                });
                prepared.push(PreparedBlock::Rich { lines, line_height });
            }
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
                    cancel,
                )?;
                measurements.push(FlowBlock::Paragraph {
                    lines: lines.len(),
                    line_height: style.line_height,
                    padding_before: style.space_before,
                    spacing_after: style.space_after,
                });
                prepared.push(PreparedBlock::Text { lines, style });
            }
            PdfBlock::List { items, ordered } => {
                const INDENT: f32 = 27.0;
                let mut lines = Vec::new();
                for (index, item) in items.iter().enumerate() {
                    check_cancel(cancel)?;
                    let wrapped = measure_text_lines(
                        item,
                        geometry.content_width() - INDENT,
                        &family,
                        &mut fonts,
                        &mut context,
                        options.text_size,
                        cancel,
                    )?;
                    for (line_index, line) in wrapped.into_iter().enumerate() {
                        let marker = if line_index == 0 {
                            Some(if *ordered {
                                format!("{}.", index + 1)
                            } else {
                                "•".to_string()
                            })
                        } else {
                            None
                        };
                        lines.push((line, marker));
                    }
                }
                let style = TextStyle {
                    font_size: options.text_size,
                    line_height: options.line_height + 2.0,
                    space_before: 12.0,
                    space_after: 11.0,
                };
                measurements.push(FlowBlock::Paragraph {
                    lines: lines.len(),
                    line_height: style.line_height,
                    padding_before: style.space_before,
                    spacing_after: style.space_after,
                });
                prepared.push(PreparedBlock::List { lines, style });
            }
            PdfBlock::Row(row) => {
                let prepared_row = row.prepare(
                    geometry.content_width(),
                    geometry.content_height(),
                    &family,
                    &mut fonts,
                    &mut context,
                    cancel,
                )?;
                total_image_pixels = total_image_pixels.saturating_add(prepared_row.image_pixels);
                if total_image_pixels > MAX_TOTAL_IMAGE_PIXELS {
                    return Err(RenderError::InvalidInput(
                        "total image pixel budget exceeded",
                    ));
                }
                measurements.push(FlowBlock::Graphic {
                    height: prepared_row.height,
                });
                prepared.push(PreparedBlock::Row(prepared_row));
            }
            PdfBlock::Graphic(graphic) => {
                graphic.validate(geometry.content_width(), geometry.content_height())?;
                measurements.push(FlowBlock::Graphic {
                    height: graphic.height,
                });
                prepared.push(PreparedBlock::Graphic);
            }
            PdfBlock::Image(image) => {
                image.validate_box(geometry.content_width(), geometry.content_height())?;
                let prepared_image = image.prepare()?;
                total_image_pixels =
                    total_image_pixels.saturating_add(prepared_image.pixel_count());
                if total_image_pixels > MAX_TOTAL_IMAGE_PIXELS {
                    return Err(RenderError::InvalidInput(
                        "total image pixel budget exceeded",
                    ));
                }
                check_cancel(cancel)?;
                measurements.push(FlowBlock::Image {
                    height: image.height,
                });
                prepared.push(PreparedBlock::Image(prepared_image));
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
                    (geometry.content_width(), geometry.content_height()),
                    cancel,
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
    let keeps = blocks
        .iter()
        .map(|b| {
            matches!(
                b,
                PdfBlock::Heading {
                    keep_with_next: true,
                    ..
                } | PdfBlock::RichParagraph {
                    keep_with_next: true,
                    ..
                }
            )
        })
        .collect::<Vec<_>>();
    let pages = paginate_flow_with_keep(&measurements, &keeps, geometry.content_height())
        .map_err(RenderError::InvalidLayout)?;
    let mut output = KrillaDocument::new();
    for (index, plan) in pages.iter().enumerate() {
        check_cancel(cancel)?;
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
            check_cancel(cancel)?;
            match fragment {
                FlowFragment::Box {
                    block,
                    start_item,
                    end_item,
                    first,
                    last,
                    height,
                } => {
                    if let (PreparedBlock::Box(prepared_box), PdfBlock::Box(source)) =
                        (&prepared[*block], &blocks[*block])
                    {
                        prepared_box.draw(
                            source,
                            &mut surface,
                            &font,
                            super::box_layout::BoxFragmentPosition {
                                left,
                                top: y,
                                start: *start_item,
                                end: *end_item,
                                first: *first,
                                last: *last,
                                height: *height,
                            },
                            cancel,
                        )?;
                    }
                    y += height;
                }
                FlowFragment::Graphic { block, height } => {
                    match (&prepared[*block], &blocks[*block]) {
                        (PreparedBlock::Row(prepared_row), PdfBlock::Row(row)) => {
                            prepared_row.draw(row, &mut surface, &font, left, y, cancel)?;
                        }
                        (_, PdfBlock::Graphic(graphic)) => graphic.draw(&mut surface, left, y)?,
                        _ => {}
                    }
                    y += height;
                }
                FlowFragment::Image { block, height } => {
                    if let (PreparedBlock::Image(prepared_image), PdfBlock::Image(image)) =
                        (&prepared[*block], &blocks[*block])
                    {
                        prepared_image.draw(&mut surface, image, left, y)?;
                    }
                    y += height;
                }
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
                            check_cancel(cancel)?;
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
                    if let PreparedBlock::Rich { lines, line_height } = &prepared[*block] {
                        for (local, rich_line) in lines[*start_line..*end_line].iter().enumerate() {
                            check_cancel(cancel)?;
                            // Place the baseline within each reserved line box;
                            // continuation pages have no extra top padding.
                            let baseline = y + padding_before + (local as f32 + 0.8) * line_height;
                            for run in rich_line {
                                let old_fill = surface.get_fill().cloned();
                                if let Some(color) = run.color {
                                    surface.set_fill(Some(Fill {
                                        paint: rgb::Color::new(color[0], color[1], color[2]).into(),
                                        ..Fill::default()
                                    }));
                                } else {
                                    surface.set_fill(None);
                                }
                                surface.draw_text(
                                    Point::from_xy(left + run.x, baseline),
                                    font_registry
                                        .as_ref()
                                        .expect("rich paragraph has registry")
                                        .font(run.font_index),
                                    run.font_size,
                                    &run.text,
                                    false,
                                    TextDirection::Auto,
                                );
                                surface.set_fill(old_fill);
                            }
                        }
                    }
                    if let PreparedBlock::List { lines, style } = &prepared[*block] {
                        for (local, (line, marker)) in
                            lines[*start_line..*end_line].iter().enumerate()
                        {
                            check_cancel(cancel)?;
                            let baseline = y + padding_before + local as f32 * style.line_height;
                            if let Some(prefix) = marker {
                                surface.draw_text(
                                    Point::from_xy(left, baseline),
                                    font.clone(),
                                    style.font_size,
                                    prefix,
                                    false,
                                    TextDirection::Auto,
                                );
                            }
                            if !line.is_empty() {
                                surface.draw_text(
                                    Point::from_xy(left + 27.0, baseline),
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
    check_cancel(cancel)?;
    output
        .finish()
        .map_err(|e| RenderError::InvalidPdf(format!("{e:?}")))
}
