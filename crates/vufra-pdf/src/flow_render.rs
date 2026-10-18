//! Rendering of ordered, styled blocks with configurable page geometry.
use super::check_cancel;
use super::{
    MAX_FONT_BYTES, MAX_TOTAL_TEXT_BYTES, PageGeometry, PdfBlock, PdfPageChrome, PdfPageMaster,
    RenderError, RenderOptions, TextStyle,
    image::{MAX_IMAGE_BLOCKS, MAX_TOTAL_IMAGE_BYTES, MAX_TOTAL_IMAGE_PIXELS, PreparedImage},
    measure_text_lines,
    rich_text::{FontRegistry, PdfFontFace, RichLine, prepare_rich},
    semantic::{ContentNode, SemanticBudget},
};
use krilla::{
    Document as KrillaDocument,
    annotation::{Annotation, LinkAnnotation, Target},
    color::rgb,
    destination::XyzDestination,
    geom::{Point, Rect},
    outline::{Outline, OutlineNode},
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
    Spacer,
    PageReference {
        label: String,
        target_block: usize,
    },
    Image(PreparedImage),
    Graphic,
    Row(super::row::PreparedRow),
    Box(super::box_layout::PreparedBox),
    GeneratedBox {
        source: super::PdfBox,
        prepared: super::box_layout::PreparedBox,
    },
    Rich {
        lines: Vec<RichLine>,
        line_height: f32,
    },
    List {
        lines: Vec<(String, Option<String>)>,
        style: TextStyle,
    },
}

fn validate_semantic_input(
    title: &str,
    canonical: &[ContentNode],
    font: &[u8],
    chrome: Option<&PdfPageChrome>,
    masters: &[PdfPageMaster],
) -> Result<(), RenderError> {
    if title.trim().is_empty() || title.contains('\0') {
        return Err(RenderError::InvalidInput(
            "title must be nonempty and contain no nulls",
        ));
    }
    if font.is_empty() || font.len() > MAX_FONT_BYTES {
        return Err(RenderError::InvalidFont);
    }
    if canonical.len() > 2_000 {
        return Err(RenderError::InvalidInput("too many content blocks"));
    }
    let mut budget = SemanticBudget {
        text_bytes: title.len(),
        ..SemanticBudget::default()
    };
    for node in canonical {
        budget.visit(node, 0)?;
        if budget.text_bytes > MAX_TOTAL_TEXT_BYTES {
            return Err(RenderError::InvalidInput("too many rows or too much text"));
        }
    }
    if masters.len() > 16 {
        return Err(RenderError::InvalidInput("too many page masters"));
    }
    for (i, master) in masters.iter().enumerate() {
        if master.title.as_ref().is_some_and(|title| {
            title.trim().is_empty()
                || title.chars().count() > 64
                || title.contains(['\0', '\r', '\n'])
        }) {
            return Err(RenderError::InvalidInput(
                "invalid PDF outline chapter title",
            ));
        }
        if master.start_block >= canonical.len()
            || (i > 0 && masters[i - 1].start_block >= master.start_block)
            || (master.start_block > 0
                && !matches!(canonical[master.start_block - 1], ContentNode::PageBreak))
        {
            return Err(RenderError::InvalidInput(
                "page masters must start at increasing page breaks",
            ));
        }
    }
    for chrome in chrome.into_iter().chain(masters.iter().map(|m| &m.chrome)) {
        for row in [
            &chrome.header,
            &chrome.footer,
            &chrome.first_header,
            &chrome.first_footer,
            &chrome.odd_header,
            &chrome.even_header,
            &chrome.odd_footer,
            &chrome.even_footer,
        ]
        .into_iter()
        .flatten()
        {
            for col in &row.columns {
                for item in &col.items {
                    budget.visit(&ContentNode::from(item.clone()), 0)?;
                }
            }
        }
    }
    if budget.text_bytes > MAX_TOTAL_TEXT_BYTES
        || budget.images > MAX_IMAGE_BLOCKS
        || budget.image_bytes > MAX_TOTAL_IMAGE_BYTES
    {
        return Err(RenderError::InvalidInput(
            "page bands exceed document budgets",
        ));
    }
    Ok(())
}

fn validate_writer_blocks(blocks: &[PdfBlock]) -> Result<(), RenderError> {
    for block in blocks {
        match block {
            PdfBlock::RichParagraph { runs, .. } if runs.is_empty() || runs.len() > 1_000 => {
                return Err(RenderError::InvalidInput(
                    "rich paragraph requires 1..1000 runs",
                ));
            }
            PdfBlock::List { items, .. }
                if items.is_empty()
                    || items.len() > 1_000
                    || items
                        .iter()
                        .any(|s| s.trim().is_empty() || s.contains('\0')) =>
            {
                return Err(RenderError::InvalidInput(
                    "list requires 1..1000 nonempty items",
                ));
            }
            PdfBlock::PageReference {
                label,
                target_block,
            } if label.trim().is_empty()
                || label.len() > 64
                || *target_block >= blocks.len()
                || matches!(
                    blocks[*target_block],
                    PdfBlock::PageBreak | PdfBlock::PageReference { .. }
                ) =>
            {
                return Err(RenderError::InvalidInput(
                    "invalid table of contents reference",
                ));
            }
            PdfBlock::Row(row) => row.validate_structure(2000.0, 2000.0)?,
            PdfBlock::Spacer { height } if !height.is_finite() || *height <= 0.0 => {
                return Err(RenderError::InvalidInput("invalid spacer height"));
            }
            _ => {}
        }
    }
    Ok(())
}

/// The owned semantic nodes are the single input of preparation. Writer
/// adapters are instantiated only after the canonical tree passes preflight.
#[allow(clippy::too_many_arguments)]
pub(crate) fn render_semantic_flow(
    title: &str,
    canonical: Vec<ContentNode>,
    font_bytes: Arc<Vec<u8>>,
    options: RenderOptions,
    geometry: PageGeometry,
    extra_fonts: Vec<PdfFontFace>,
    chrome: Option<&PdfPageChrome>,
    masters: &[PdfPageMaster],
    cancel: &AtomicBool,
) -> Result<Vec<u8>, RenderError> {
    check_cancel(cancel)?;
    geometry.validate()?;
    // Preflight the canonical tree before consuming it. This keeps one
    // ownership path from NAPI to the painter without cloning image buffers.
    validate_semantic_input(title, &canonical, &font_bytes, chrome, masters)?;
    let writer = canonical
        .into_iter()
        .map(PdfBlock::try_from)
        .collect::<Result<Vec<_>, _>>()?;
    validate_writer_blocks(&writer)?;
    render_writer_flow(
        title,
        &writer,
        font_bytes,
        options,
        geometry,
        extra_fonts,
        chrome,
        masters,
        cancel,
    )
}

#[allow(clippy::too_many_arguments)]
fn render_writer_flow(
    title: &str,
    blocks: &[PdfBlock],
    font_bytes: Arc<Vec<u8>>,
    options: RenderOptions,
    mut geometry: PageGeometry,
    extra_fonts: Vec<PdfFontFace>,
    chrome: Option<&PdfPageChrome>,
    masters: &[PdfPageMaster],
    cancel: &AtomicBool,
) -> Result<Vec<u8>, RenderError> {
    // One font payload is shared between Krilla, Parley and glyph coverage.
    let regular_bytes = font_bytes;
    let font = Font::new(regular_bytes.clone().into(), 0).ok_or(RenderError::InvalidFont)?;
    let mut fonts = FontContext {
        collection: Collection::new(CollectionOptions {
            shared: false,
            system_fonts: false,
        }),
        source_cache: SourceCache::default(),
    };
    let registered = fonts
        .collection
        .register_fonts(Blob::new(regular_bytes.clone()), None);
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
    let mut font_registry = if chrome.is_some()
        || !masters.is_empty()
        || !extra_fonts.is_empty()
        || blocks.iter().any(|b| {
            matches!(
                b,
                PdfBlock::RichParagraph { .. } | PdfBlock::Box(_) | PdfBlock::Row(_)
            )
        }) {
        Some(FontRegistry::new(regular_bytes, extra_fonts)?)
    } else {
        None
    };
    let base_geometry = geometry;
    for current in chrome.into_iter().chain(masters.iter().map(|m| &m.chrome)) {
        let measured = current.reserve(
            base_geometry,
            &family,
            &mut fonts,
            &mut context,
            font_registry.as_mut().expect("chrome needs font registry"),
            cancel,
        )?;
        geometry.margin_top = geometry.margin_top.max(measured.margin_top);
        geometry.margin_bottom = geometry.margin_bottom.max(measured.margin_bottom);
    }
    geometry.validate()?;
    let mut prepared = Vec::with_capacity(blocks.len());
    let mut measurements = Vec::with_capacity(blocks.len());
    let mut total_image_pixels = 0u64;
    for c in chrome.into_iter().chain(masters.iter().map(|m| &m.chrome)) {
        for row in [
            &c.header,
            &c.footer,
            &c.first_header,
            &c.first_footer,
            &c.odd_header,
            &c.even_header,
            &c.odd_footer,
            &c.even_footer,
        ]
        .into_iter()
        .flatten()
        {
            for col in &row.columns {
                for item in &col.items {
                    if let super::row::PdfRowItem::Image(image) = item {
                        total_image_pixels =
                            total_image_pixels.saturating_add(image.prepare()?.pixel_count());
                    }
                }
            }
        }
        if total_image_pixels > MAX_TOTAL_IMAGE_PIXELS {
            return Err(RenderError::InvalidInput(
                "page bands exceed image pixel budget",
            ));
        }
    }
    for block in blocks {
        check_cancel(cancel)?;
        match block {
            PdfBlock::Box(boxed) => {
                let prepared_box = boxed.prepare(
                    (geometry.content_width(), geometry.content_height()),
                    &family,
                    &mut fonts,
                    &mut context,
                    font_registry
                        .as_mut()
                        .expect("nested content has font registry"),
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
                    repeat_headers: prepared_box.repeat_headers.clone(),
                    nested_spans: prepared_box.nested_spans.clone(),
                    keep_together: boxed.keep_together,
                    break_before: boxed.break_before,
                });
                prepared.push(PreparedBlock::Box(prepared_box));
            }
            PdfBlock::PageBreak => {
                measurements.push(FlowBlock::PageBreak);
                prepared.push(PreparedBlock::Spacer);
            }
            PdfBlock::PageReference {
                label,
                target_block,
            } => {
                let shaped = measure_text_lines(
                    label,
                    geometry.content_width() - 65.0,
                    &family,
                    &mut fonts,
                    &mut context,
                    options.text_size,
                    cancel,
                )?;
                if shaped.len() != 1 || label.contains('\n') || label.contains('\r') {
                    return Err(RenderError::InvalidInput(
                        "table of contents label must fit one line",
                    ));
                }
                measurements.push(FlowBlock::Graphic { height: 26.0 });
                prepared.push(PreparedBlock::PageReference {
                    label: label.clone(),
                    target_block: *target_block,
                });
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
                let result = row.prepare_allow_overflow_depth(
                    (geometry.content_width(), geometry.content_height()),
                    &family,
                    &mut fonts,
                    &mut context,
                    font_registry
                        .as_mut()
                        .expect("nested content has font registry"),
                    cancel,
                    0,
                );
                match result {
                    Ok(prepared_row)
                        if prepared_row.height <= geometry.content_height() + 0.001 =>
                    {
                        total_image_pixels =
                            total_image_pixels.saturating_add(prepared_row.image_pixels);
                        measurements.push(FlowBlock::Graphic {
                            height: prepared_row.height,
                        });
                        prepared.push(PreparedBlock::Row(prepared_row));
                    }
                    Ok(prepared_row) => {
                        let source = row.fragments_from_prepared(prepared_row)?;
                        let prepared_box = source.prepare(
                            (geometry.content_width(), geometry.content_height()),
                            &family,
                            &mut fonts,
                            &mut context,
                            font_registry
                                .as_mut()
                                .expect("nested content has font registry"),
                            cancel,
                        )?;
                        total_image_pixels =
                            total_image_pixels.saturating_add(prepared_box.image_pixels);
                        measurements.push(FlowBlock::Box {
                            item_heights: prepared_box.item_heights.clone(),
                            padding: 0.0,
                            repeat_headers: prepared_box.repeat_headers.clone(),
                            nested_spans: prepared_box.nested_spans.clone(),
                            keep_together: false,
                            break_before: false,
                        });
                        prepared.push(PreparedBlock::GeneratedBox {
                            source,
                            prepared: prepared_box,
                        });
                    }
                    Err(error) => return Err(error),
                }
                if total_image_pixels > MAX_TOTAL_IMAGE_PIXELS {
                    return Err(RenderError::InvalidInput(
                        "total image pixel budget exceeded",
                    ));
                }
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
                } | PdfBlock::Box(super::PdfBox {
                    keep_with_next: true,
                    ..
                })
            )
        })
        .collect::<Vec<_>>();
    let pages = paginate_flow_with_keep(&measurements, &keeps, geometry.content_height())
        .map_err(RenderError::InvalidLayout)?;
    // Capture the real top-left position of each block's first rendered
    // fragment. Both chapter links and arbitrary named anchors use these
    // coordinates rather than the generic page-top location.
    let mut locations: Vec<Option<(usize, f32)>> = vec![None; blocks.len()];
    for (page, plan) in pages.iter().enumerate() {
        let mut y = geometry.margin_top;
        for fragment in &plan.fragments {
            let (block, height) = match fragment {
                FlowFragment::Box { block, height, .. }
                | FlowFragment::Graphic { block, height }
                | FlowFragment::Image { block, height }
                | FlowFragment::Spacer { block, height }
                | FlowFragment::Paragraph { block, height, .. } => (*block, *height),
            };
            if locations[block].is_none() {
                locations[block] = Some((page, y));
            }
            y += height;
        }
    }
    for block in blocks {
        if let PdfBlock::PageReference { target_block, .. } = block {
            let Some((target_page, _)) = locations[*target_block] else {
                return Err(RenderError::InvalidInput(
                    "page reference target has no rendered page",
                ));
            };
            // The page number is drawn in a reserved right-hand track.
            // Never overflow that track silently for unusually huge reports.
            let shaped = measure_text_lines(
                &(target_page + 1).to_string(),
                42.0,
                &family,
                &mut fonts,
                &mut context,
                options.text_size,
                cancel,
            )?;
            if shaped.len() != 1 {
                return Err(RenderError::InvalidInput(
                    "page reference number exceeds reserved width",
                ));
            }
        }
    }
    // PDF outlines share the exact final pagination with TOC references.
    // All target indices are validated before creating Krilla destinations.
    let mut outline = Outline::new();
    let mut has_outline = false;
    for master in masters {
        if let Some(title) = &master.title {
            let (page, y) = locations[master.start_block].ok_or(RenderError::InvalidInput(
                "PDF outline target not paginated",
            ))?;
            outline.push_child(OutlineNode::new(
                title.clone(),
                XyzDestination::new(page, Point::from_xy(geometry.margin_left, y)),
            ));
            has_outline = true;
        }
    }
    let mut output = KrillaDocument::new();
    let mut last_body_block = 0usize;
    let mut prior_master: Option<usize> = None;
    for (index, plan) in pages.iter().enumerate() {
        check_cancel(cancel)?;
        if let Some(first_fragment) = plan.fragments.first() {
            last_body_block = match first_fragment {
                FlowFragment::Box { block, .. }
                | FlowFragment::Graphic { block, .. }
                | FlowFragment::Image { block, .. }
                | FlowFragment::Spacer { block, .. }
                | FlowFragment::Paragraph { block, .. } => *block,
            };
        }
        let master_index = masters
            .iter()
            .rposition(|master| master.start_block <= last_body_block);
        // Chapter first-page is detected from a master transition, not the
        // first block of its table (that block can continue over many pages).
        let section_first = index == 0 || master_index.is_some() && master_index != prior_master;
        prior_master = master_index;
        let active = master_index.map(|i| &masters[i].chrome).or(chrome);
        let settings = PageSettings::from_wh(geometry.width, geometry.height)
            .ok_or(RenderError::InvalidInput("invalid paper size"))?;
        let mut page = output.start_page_with(settings);
        // Page annotations are added only after the paint surface is finished.
        // Collect locations from the same fragments used to draw the text.
        let mut links: Vec<(Rect, usize, String)> = Vec::new();
        let mut surface = page.surface();
        let left = geometry.margin_left;
        if active.is_none_or(|c| c.should_draw_default_header_for(index, section_first)) {
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
        }
        if active.is_none_or(|c| c.should_draw_default_footer_for(index, section_first)) {
            surface.draw_text(
                Point::from_xy(left, geometry.height - geometry.margin_bottom * 0.4),
                font.clone(),
                10.0,
                &format!("Página {} / {}", index + 1, pages.len()),
                false,
                TextDirection::Auto,
            );
        }
        if let Some(chrome) = active {
            chrome.draw(
                index,
                pages.len(),
                section_first,
                geometry,
                &mut surface,
                &font,
                &family,
                &mut fonts,
                &mut context,
                font_registry.as_mut().expect("chrome needs font registry"),
                cancel,
            )?;
        }
        let mut y = geometry.margin_top;
        for fragment in &plan.fragments {
            check_cancel(cancel)?;
            match fragment {
                FlowFragment::Box {
                    block,
                    start_item,
                    end_item,
                    repeat_header,
                    first,
                    last,
                    height,
                } => {
                    let fragment_source = match (&prepared[*block], &blocks[*block]) {
                        (PreparedBlock::Box(prepared_box), PdfBlock::Box(source)) => {
                            Some((prepared_box, source))
                        }
                        (PreparedBlock::GeneratedBox { source, prepared }, _) => {
                            Some((prepared, source))
                        }
                        _ => None,
                    };
                    if let Some((prepared_box, source)) = fragment_source {
                        prepared_box.draw(
                            source,
                            &mut surface,
                            &font,
                            font_registry
                                .as_ref()
                                .expect("nested content has font registry"),
                            super::box_layout::BoxFragmentPosition {
                                left,
                                top: y,
                                start: *start_item,
                                end: *end_item,
                                repeat_header: *repeat_header,
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
                            prepared_row.draw(
                                row,
                                &mut surface,
                                &font,
                                font_registry
                                    .as_ref()
                                    .expect("nested content has font registry"),
                                (left, y),
                                cancel,
                            )?;
                        }
                        (
                            PreparedBlock::PageReference {
                                label,
                                target_block,
                            },
                            _,
                        ) => {
                            let (page_number, _) = locations[*target_block]
                                .ok_or(RenderError::InvalidInput("unresolved page reference"))?;
                            let number = page_number + 1;
                            surface.draw_text(
                                Point::from_xy(left, y + 15.0),
                                font.clone(),
                                options.text_size,
                                label,
                                false,
                                TextDirection::Auto,
                            );
                            surface.draw_text(
                                Point::from_xy(left + geometry.content_width() - 42.0, y + 15.0),
                                font.clone(),
                                options.text_size,
                                &number.to_string(),
                                false,
                                TextDirection::Auto,
                            );
                            let area = Rect::from_xywh(left, y, geometry.content_width(), *height)
                                .ok_or(RenderError::InvalidInput(
                                    "invalid page reference link rectangle",
                                ))?;
                            links.push((area, *target_block, label.clone()));
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
                        prepared_image.draw(&mut surface, image.placement(), left, y)?;
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
            }
        }
        surface.finish();
        for (rect, target_block, label) in links {
            let (target_page, target_y) = locations[target_block]
                .ok_or(RenderError::InvalidInput("unresolved link destination"))?;
            let destination =
                XyzDestination::new(target_page, Point::from_xy(geometry.margin_left, target_y));
            page.add_annotation(Annotation::new_link(
                LinkAnnotation::new(rect, Target::Destination(destination.into())),
                Some(format!("Go to {label}")),
            ));
        }
        page.finish();
    }
    if has_outline {
        output.set_outline(outline);
    }
    check_cancel(cancel)?;
    output
        .finish()
        .map_err(|e| RenderError::InvalidPdf(format!("{e:?}")))
}

#[cfg(test)]
mod section_master_tests {
    use super::*;
    #[test]
    fn outline_titles_are_native_validated_even_when_bypassing_the_sdk() {
        let canonical = vec![ContentNode::paragraph("CHAPTER")];
        let valid = PdfPageMaster {
            start_block: 0,
            chrome: PdfPageChrome::default(),
            title: Some("Financial overview".into()),
        };
        assert!(
            validate_semantic_input(
                "Document",
                &canonical,
                &[1],
                None,
                std::slice::from_ref(&valid)
            )
            .is_ok()
        );
        for title in [" ".to_owned(), "Bad\nTitle".to_owned(), "X".repeat(65)] {
            let mut invalid = valid.clone();
            invalid.title = Some(title);
            assert!(
                validate_semantic_input("Document", &canonical, &[1], None, &[invalid]).is_err()
            );
        }
    }
    #[test]
    fn page_references_require_valid_existing_non_reference_targets() {
        let good = vec![
            PdfBlock::PageReference {
                label: "Finance".into(),
                target_block: 1,
            },
            PdfBlock::Paragraph("Financial chapter".into()),
        ];
        assert!(validate_writer_blocks(&good).is_ok());
        assert!(
            validate_writer_blocks(&[
                PdfBlock::PageReference {
                    label: "Missing".into(),
                    target_block: 999
                },
                PdfBlock::Paragraph("Chapter".into()),
            ])
            .is_err()
        );
        assert!(
            validate_writer_blocks(&[PdfBlock::PageReference {
                label: "Self".into(),
                target_block: 0
            },])
            .is_err()
        );
        assert!(
            validate_writer_blocks(&[
                PdfBlock::PageReference {
                    label: "".into(),
                    target_block: 1
                },
                PdfBlock::Paragraph("Chapter".into()),
            ])
            .is_err()
        );
    }
    #[test]
    fn section_masters_require_monotone_page_break_boundaries() {
        let canonical = vec![
            ContentNode::paragraph("ONE"),
            ContentNode::PageBreak,
            ContentNode::paragraph("TWO"),
            ContentNode::PageBreak,
            ContentNode::paragraph("THREE"),
        ];
        let master = |start_block| PdfPageMaster {
            start_block,
            chrome: PdfPageChrome::default(),
            title: None,
        };
        assert!(
            validate_semantic_input(
                "Test",
                &canonical,
                &[42],
                None,
                &[master(0), master(2), master(4)]
            )
            .is_ok()
        );
        assert!(
            validate_semantic_input("Test", &canonical, &[42], None, &[master(0), master(3)])
                .is_err()
        );
        assert!(
            validate_semantic_input("Test", &canonical, &[42], None, &[master(2), master(2)])
                .is_err()
        );
        assert!(validate_semantic_input("Test", &canonical, &[42], None, &[master(99)]).is_err());
    }
}
#[cfg(test)]
mod owned_font_tests {
    use super::*;
    #[test]
    fn owned_font_vec_moves_to_single_krilla_fontique_allocation() {
        let bytes = vec![7u8; 3 * 1024 * 1024];
        let address = bytes.as_ptr();
        let shared = Arc::new(bytes);
        assert_eq!(
            shared.as_ptr(),
            address,
            "Arc wrapping must move, not clone"
        );
        let krilla_data: krilla::Data = shared.clone().into();
        let fontique_blob = Blob::new(shared.clone());
        assert_eq!(krilla_data.as_ref().as_ptr(), address);
        assert_eq!(fontique_blob.as_ref().as_ptr(), address);
        assert_eq!(Arc::strong_count(&shared), 3);
    }
}
