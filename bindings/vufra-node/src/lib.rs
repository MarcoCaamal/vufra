//! Small N-API bridge. Keep all PDF logic inside vufra-pdf.
use napi::{
    Env, Task,
    bindgen_prelude::{AsyncTask, Buffer},
};
use napi_derive::napi;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};
use vufra_pdf::{
    BoxAlign, GraphicKind, ImageFit, MAX_IMAGE_BLOCKS, MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES,
    PageGeometry, PdfBlock, PdfBox, PdfBoxItem, PdfBoxTable, PdfColumn, PdfDocument, PdfFontFace,
    PdfGraphic, PdfImage, PdfPageChrome, PdfRow, PdfRowColumn, PdfRowItem, PdfTable, PdfTextRun,
    RenderOptions, TextStyle,
};

#[napi(object)]
pub struct NodeTableColumn {
    pub header: String,
    pub width: f64,
}

#[napi(object)]
pub struct NodeTable {
    pub columns: Vec<NodeTableColumn>,
    pub rows: Vec<Vec<String>>,
}

#[napi(object)]
pub struct NodeBlock {
    pub kind: String,
    pub text: Option<String>,
    pub runs: Option<Vec<NodeRichRun>>,
    pub table: Option<NodeTable>,
    pub image: Option<NodeImage>,
    pub items: Option<Vec<String>>,
    pub ordered: Option<bool>,
    pub keep_with_next: Option<bool>,
    pub graphic: Option<NodeGraphic>,
    pub row: Option<NodeRow>,
    pub box_data: Option<NodeBox>,
    pub level: Option<u32>,
    pub style: Option<NodeTextStyle>,
    pub height: Option<f64>,
}

#[napi(object)]
pub struct NodeRichRun {
    pub text: String,
    pub font: String,
    pub font_size: Option<f64>,
    pub color: Option<String>,
    pub fallback_fonts: Option<Vec<String>>,
}
#[napi(object)]
pub struct NodeFontFace {
    pub name: String,
    pub data: Buffer,
}
#[napi(object)]
pub struct NodeRowItem {
    pub kind: String,
    pub runs: Option<Vec<NodeRichRun>>,
    pub text: Option<String>,
    pub style: Option<NodeTextStyle>,
    pub height: Option<f64>,
    pub image: Option<NodeImage>,
    pub graphic: Option<NodeGraphic>,
}
#[napi(object)]
pub struct NodeRowColumn {
    pub width: f64,
    pub right_align: bool,
    pub items: Vec<NodeRowItem>,
}
#[napi(object)]
pub struct NodeRow {
    pub gap: f64,
    pub columns: Vec<NodeRowColumn>,
}
#[napi(object)]
pub struct NodeBoxTable {
    pub header: NodeRow,
    pub rows: Vec<NodeRow>,
    pub fills: Vec<Vec<Option<String>>>,
}
#[napi(object)]
pub struct NodeBoxItem {
    pub kind: String,
    pub runs: Option<Vec<NodeRichRun>>,
    pub text: Option<String>,
    pub style: Option<NodeTextStyle>,
    pub color: Option<String>,
    pub height: Option<f64>,
    pub image: Option<NodeImage>,
    pub graphic: Option<NodeGraphic>,
    pub row: Option<NodeRow>,
    pub table_data: Option<NodeBoxTable>,
}
#[napi(object)]
pub struct NodeBox {
    pub width: Option<f64>,
    pub align: String,
    pub padding: f64,
    pub border_width: f64,
    pub border_color: Option<String>,
    pub background: Option<String>,
    pub keep_together: Option<bool>,
    pub break_before: Option<bool>,
    pub keep_with_next: Option<bool>,
    pub items: Vec<NodeBoxItem>,
}
#[napi(object)]
pub struct NodePageChrome {
    pub header: Option<NodeRow>,
    pub footer: Option<NodeRow>,
    pub first_header: Option<NodeRow>,
    pub first_footer: Option<NodeRow>,
    pub hide_header: Option<bool>,
    pub hide_footer: Option<bool>,
    pub hide_first_header: Option<bool>,
    pub hide_first_footer: Option<bool>,
}

#[napi(object)]
pub struct NodeGraphic {
    pub kind: String,
    pub width: f64,
    pub height: f64,
    pub color: String,
}
#[napi(object)]
pub struct NodeImage {
    pub data: Buffer,
    pub width: f64,
    pub height: f64,
    pub fit: String,
}
#[napi(object)]
pub struct NodeTextStyle {
    pub font_size: f64,
    pub line_height: f64,
    pub space_before: f64,
    pub space_after: f64,
}

#[napi(object)]
pub struct NodePage {
    pub width: f64,
    pub height: f64,
    pub margin_top: f64,
    pub margin_bottom: f64,
    pub margin_left: f64,
    pub margin_right: f64,
}
impl From<NodePage> for PageGeometry {
    fn from(p: NodePage) -> Self {
        Self {
            width: p.width as f32,
            height: p.height as f32,
            margin_top: p.margin_top as f32,
            margin_bottom: p.margin_bottom as f32,
            margin_left: p.margin_left as f32,
            margin_right: p.margin_right as f32,
        }
    }
}
impl From<NodeTextStyle> for TextStyle {
    fn from(s: NodeTextStyle) -> Self {
        Self {
            font_size: s.font_size as f32,
            line_height: s.line_height as f32,
            space_before: s.space_before as f32,
            space_after: s.space_after as f32,
        }
    }
}

fn to_graphic(g: NodeGraphic) -> napi::Result<PdfGraphic> {
    let kind = match g.kind.as_str() {
        "rule" => GraphicKind::Rule,
        "rectangle" => GraphicKind::Rectangle,
        _ => return Err(napi::Error::from_reason("invalid graphic kind")),
    };
    let b = g.color.as_bytes();
    if b.len() != 7 || b[0] != b'#' || !b[1..].iter().all(u8::is_ascii_hexdigit) {
        return Err(napi::Error::from_reason("graphic color must be #RRGGBB"));
    }
    let mut rgb = [0u8; 3];
    for (i, value) in rgb.iter_mut().enumerate() {
        *value = u8::from_str_radix(&g.color[(1 + i * 2)..(3 + i * 2)], 16)
            .map_err(|_| napi::Error::from_reason("invalid graphic color"))?;
    }
    Ok(PdfGraphic {
        kind,
        width: g.width as f32,
        height: g.height as f32,
        rgb,
    })
}
fn optional_rgb(input: Option<String>) -> napi::Result<Option<[u8; 3]>> {
    input
        .map(|c| {
            if c.len() != 7
                || !c.starts_with('#')
                || !c.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
            {
                return Err(napi::Error::from_reason("box colors must be #RRGGBB"));
            }
            let mut rgb = [0u8; 3];
            for (i, v) in rgb.iter_mut().enumerate() {
                *v = u8::from_str_radix(&c[(1 + i * 2)..(3 + i * 2)], 16)
                    .map_err(|_| napi::Error::from_reason("invalid box RGB color"))?;
            }
            Ok(rgb)
        })
        .transpose()
}
fn to_runs(runs: Vec<NodeRichRun>) -> napi::Result<Vec<PdfTextRun>> {
    runs.into_iter()
        .map(|r| {
            Ok(PdfTextRun {
                text: r.text,
                font: r.font,
                font_size: r.font_size.map(|v| v as f32),
                color: optional_rgb(r.color)?,
                fallback_fonts: r.fallback_fonts.unwrap_or_default(),
            })
        })
        .collect()
}
fn to_box(input: NodeBox) -> napi::Result<PdfBox> {
    let align = match input.align.as_str() {
        "left" => BoxAlign::Left,
        "center" => BoxAlign::Center,
        "right" => BoxAlign::Right,
        _ => {
            return Err(napi::Error::from_reason(
                "box align must be left,center,right",
            ));
        }
    };
    let items = input
        .items
        .into_iter()
        .map(|item| match item.kind.as_str() {
            "text" => Ok(PdfBoxItem::Text {
                text: item
                    .text
                    .ok_or_else(|| napi::Error::from_reason("box text required"))?,
                style: item
                    .style
                    .ok_or_else(|| napi::Error::from_reason("box text style required"))?
                    .into(),
                color: optional_rgb(item.color)?,
            }),
            "rich" => Ok(PdfBoxItem::RichText {
                runs: to_runs(
                    item.runs
                        .ok_or_else(|| napi::Error::from_reason("box rich runs required"))?,
                )?,
                style: item
                    .style
                    .ok_or_else(|| napi::Error::from_reason("box rich style required"))?
                    .into(),
            }),
            "image" => Ok(PdfBoxItem::Image(to_image(
                item.image
                    .ok_or_else(|| napi::Error::from_reason("box image required"))?,
            )?)),
            "graphic" => Ok(PdfBoxItem::Graphic(to_graphic(
                item.graphic
                    .ok_or_else(|| napi::Error::from_reason("box graphic required"))?,
            )?)),
            "spacer" => Ok(PdfBoxItem::Spacer(
                item.height
                    .ok_or_else(|| napi::Error::from_reason("box spacer required"))?
                    as f32,
            )),
            "row" => {
                Ok(PdfBoxItem::Row(to_row(item.row.ok_or_else(|| {
                    napi::Error::from_reason("box row required")
                })?)?))
            }
            "table" => {
                let table = item
                    .table_data
                    .ok_or_else(|| napi::Error::from_reason("boxed table required"))?;
                Ok(PdfBoxItem::Table(PdfBoxTable {
                    header: to_row(table.header)?,
                    rows: table
                        .rows
                        .into_iter()
                        .map(to_row)
                        .collect::<napi::Result<Vec<_>>>()?,
                    fills: table
                        .fills
                        .into_iter()
                        .map(|colors| {
                            colors
                                .into_iter()
                                .map(optional_rgb)
                                .collect::<napi::Result<Vec<_>>>()
                        })
                        .collect::<napi::Result<Vec<_>>>()?,
                }))
            }
            _ => Err(napi::Error::from_reason("unsupported box item")),
        })
        .collect::<napi::Result<Vec<_>>>()?;
    Ok(PdfBox {
        width: input.width.map(|w| w as f32),
        align,
        padding: input.padding as f32,
        border_width: input.border_width as f32,
        border_color: optional_rgb(input.border_color)?,
        background: optional_rgb(input.background)?,
        keep_together: input.keep_together.unwrap_or(false),
        break_before: input.break_before.unwrap_or(false),
        keep_with_next: input.keep_with_next.unwrap_or(false),
        items,
    })
}
fn to_row(input: NodeRow) -> napi::Result<PdfRow> {
    let columns = input
        .columns
        .into_iter()
        .map(|column| {
            let items = column
                .items
                .into_iter()
                .map(|item| match item.kind.as_str() {
                    "text" => Ok(PdfRowItem::Text {
                        text: item
                            .text
                            .ok_or_else(|| napi::Error::from_reason("row text is required"))?,
                        style: item
                            .style
                            .ok_or_else(|| napi::Error::from_reason("row text style is required"))?
                            .into(),
                    }),
                    "rich" => {
                        Ok(PdfRowItem::RichText {
                            runs: to_runs(item.runs.ok_or_else(|| {
                                napi::Error::from_reason("row rich runs required")
                            })?)?,
                            style: item
                                .style
                                .ok_or_else(|| napi::Error::from_reason("row rich style required"))?
                                .into(),
                        })
                    }
                    "image" => Ok(PdfRowItem::Image(to_image(
                        item.image
                            .ok_or_else(|| napi::Error::from_reason("row image is required"))?,
                    )?)),
                    "graphic" => Ok(PdfRowItem::Graphic(to_graphic(
                        item.graphic
                            .ok_or_else(|| napi::Error::from_reason("row graphic is required"))?,
                    )?)),
                    "spacer" => {
                        Ok(PdfRowItem::Spacer(item.height.ok_or_else(|| {
                            napi::Error::from_reason("row spacer height is required")
                        })? as f32))
                    }
                    _ => Err(napi::Error::from_reason("unsupported item in row column")),
                })
                .collect::<napi::Result<Vec<_>>>()?;
            Ok(PdfRowColumn {
                width: column.width as f32,
                right_align: column.right_align,
                items,
            })
        })
        .collect::<napi::Result<Vec<_>>>()?;
    Ok(PdfRow {
        gap: input.gap as f32,
        columns,
    })
}
fn to_image(input: NodeImage) -> napi::Result<PdfImage> {
    if input.data.is_empty() || input.data.len() > MAX_IMAGE_BYTES {
        return Err(napi::Error::from_reason(
            "image bytes exceed the 8 MiB limit",
        ));
    }
    let fit = match input.fit.as_str() {
        "contain" => ImageFit::Contain,
        "cover" => ImageFit::Cover,
        _ => {
            return Err(napi::Error::from_reason(
                "Image fit must be contain or cover",
            ));
        }
    };
    Ok(PdfImage {
        data: input.data.to_vec(),
        width: input.width as f32,
        height: input.height as f32,
        fit,
    })
}
fn to_table(input: NodeTable) -> PdfTable {
    PdfTable {
        columns: input
            .columns
            .into_iter()
            .map(|column| PdfColumn {
                header: column.header,
                width: column.width as f32,
            })
            .collect(),
        rows: input.rows,
    }
}

fn preflight_image(image: &NodeImage, count: &mut usize, total: &mut usize) -> napi::Result<()> {
    if image.data.is_empty() || image.data.len() > MAX_IMAGE_BYTES {
        return Err(napi::Error::from_reason(
            "image bytes exceed the 8 MiB limit",
        ));
    }
    *count += 1;
    *total = total
        .checked_add(image.data.len())
        .ok_or_else(|| napi::Error::from_reason("too many image bytes"))?;
    if *count > MAX_IMAGE_BLOCKS || *total > MAX_TOTAL_IMAGE_BYTES {
        return Err(napi::Error::from_reason(
            "too many images or too much image data",
        ));
    }
    Ok(())
}
fn preflight_row_images(row: &NodeRow, count: &mut usize, total: &mut usize) -> napi::Result<()> {
    for column in &row.columns {
        for item in &column.items {
            if let Some(image) = &item.image {
                preflight_image(image, count, total)?;
            }
        }
    }
    Ok(())
}
#[allow(clippy::too_many_arguments)]
fn parse_document(
    title: String,
    paragraphs: Vec<String>,
    rows: Vec<String>,
    table: Option<NodeTable>,
    blocks: Option<Vec<NodeBlock>>,
    page: Option<NodePage>,
    font_faces: Option<Vec<NodeFontFace>>,
    chrome: Option<NodePageChrome>,
) -> napi::Result<PdfDocument> {
    // Verify image budgets recursively before copying native input buffers.
    // Covers regular images, rows, and decorated boxes (including row items
    // within a boxed content block).
    let mut count = 0usize;
    let mut bytes = 0usize;
    if let Some(items) = &blocks {
        for block in items {
            if let Some(image) = &block.image {
                preflight_image(image, &mut count, &mut bytes)?;
            }
            if let Some(row) = &block.row {
                preflight_row_images(row, &mut count, &mut bytes)?;
            }
            if let Some(boxed) = &block.box_data {
                for item in &boxed.items {
                    if let Some(image) = &item.image {
                        preflight_image(image, &mut count, &mut bytes)?;
                    }
                    if let Some(row) = &item.row {
                        preflight_row_images(row, &mut count, &mut bytes)?;
                    }
                    if let Some(table) = &item.table_data {
                        preflight_row_images(&table.header, &mut count, &mut bytes)?;
                        for row in &table.rows {
                            preflight_row_images(row, &mut count, &mut bytes)?;
                        }
                    }
                }
            }
        }
    }
    if let Some(c) = &chrome {
        for row in [&c.header, &c.footer, &c.first_header, &c.first_footer]
            .into_iter()
            .flatten()
        {
            preflight_row_images(row, &mut count, &mut bytes)?;
        }
        if count > MAX_IMAGE_BLOCKS || bytes > MAX_TOTAL_IMAGE_BYTES {
            return Err(napi::Error::from_reason("page bands exceed image budget"));
        }
    }
    if font_faces.as_ref().is_some_and(|faces| {
        faces.len() > 6
            || faces
                .iter()
                .any(|f| f.data.is_empty() || f.data.len() > 12 * 1024 * 1024)
            || faces
                .iter()
                .try_fold(0usize, |sum, f| sum.checked_add(f.data.len()))
                .is_none_or(|total| total > 30 * 1024 * 1024)
    }) {
        return Err(napi::Error::from_reason(
            "font faces exceed count or byte limits",
        ));
    }
    let doc = PdfDocument {
        title,
        paragraphs,
        rows,
        table: table.map(to_table),
        page: page.map(Into::into),
        chrome: chrome
            .map(|c| {
                Ok::<PdfPageChrome, napi::Error>(PdfPageChrome {
                    header: c.header.map(to_row).transpose()?,
                    footer: c.footer.map(to_row).transpose()?,
                    first_header: c.first_header.map(to_row).transpose()?,
                    first_footer: c.first_footer.map(to_row).transpose()?,
                    hide_header: c.hide_header.unwrap_or(false),
                    hide_footer: c.hide_footer.unwrap_or(false),
                    hide_first_header: c.hide_first_header.unwrap_or(false),
                    hide_first_footer: c.hide_first_footer.unwrap_or(false),
                })
            })
            .transpose()?,
        fonts: font_faces
            .unwrap_or_default()
            .into_iter()
            .map(|f| PdfFontFace {
                name: f.name,
                data: f.data.to_vec(),
            })
            .collect(),
        blocks: blocks
            .map(|items| {
                items
                    .into_iter()
                    .map(|item| match item.kind.as_str() {
                        "image"
                            if item.image.is_some()
                                && item.text.is_none()
                                && item.table.is_none() =>
                        {
                            Ok(PdfBlock::Image(to_image(
                                item.image.expect("image checked"),
                            )?))
                        }
                        "page-break" if item.row.is_none() && item.text.is_none() => {
                            Ok(PdfBlock::PageBreak)
                        }
                        "box" if item.box_data.is_some() && item.table.is_none() => {
                            Ok(PdfBlock::Box(to_box(item.box_data.expect("box checked"))?))
                        }
                        "row" if item.row.is_some() && item.table.is_none() => {
                            Ok(PdfBlock::Row(to_row(item.row.expect("row checked"))?))
                        }
                        "list"
                            if item.items.is_some()
                                && item.table.is_none()
                                && item.image.is_none() =>
                        {
                            Ok(PdfBlock::List {
                                items: item.items.expect("items checked"),
                                ordered: item.ordered.unwrap_or(false),
                            })
                        }
                        "graphic"
                            if item.graphic.is_some()
                                && item.table.is_none()
                                && item.image.is_none() =>
                        {
                            Ok(PdfBlock::Graphic(to_graphic(
                                item.graphic.expect("graphic checked"),
                            )?))
                        }
                        "rich-paragraph"
                            if item.runs.is_some()
                                && item.style.is_some()
                                && item.text.is_none()
                                && item.table.is_none() =>
                        {
                            Ok(PdfBlock::RichParagraph {
                                runs: item
                                    .runs
                                    .expect("runs checked")
                                    .into_iter()
                                    .map(|r| {
                                        Ok(PdfTextRun {
                                            text: r.text,
                                            font: r.font,
                                            font_size: r.font_size.map(|s| s as f32),
                                            fallback_fonts: r.fallback_fonts.unwrap_or_default(),
                                            color: r
                                                .color
                                                .map(|c| {
                                                    let b = c.as_bytes();
                                                    if b.len() != 7
                                                        || b[0] != b'#'
                                                        || !b[1..].iter().all(u8::is_ascii_hexdigit)
                                                    {
                                                        return Err(napi::Error::from_reason(
                                                            "rich text color must be #RRGGBB",
                                                        ));
                                                    }
                                                    let mut rgb = [0u8; 3];
                                                    for (i, v) in rgb.iter_mut().enumerate() {
                                                        *v = u8::from_str_radix(
                                                            &c[(1 + 2 * i)..(3 + 2 * i)],
                                                            16,
                                                        )
                                                        .map_err(|_| {
                                                            napi::Error::from_reason(
                                                                "invalid rich text color",
                                                            )
                                                        })?;
                                                    }
                                                    Ok(rgb)
                                                })
                                                .transpose()?,
                                        })
                                    })
                                    .collect::<napi::Result<Vec<_>>>()?,
                                style: item.style.expect("style checked").into(),
                                keep_with_next: item.keep_with_next.unwrap_or(false),
                            })
                        }
                        "paragraph" if item.text.is_some() && item.table.is_none() => {
                            Ok(PdfBlock::Paragraph(item.text.unwrap_or_default()))
                        }
                        "heading" if item.text.is_some() && item.table.is_none() => {
                            Ok(PdfBlock::Heading {
                                text: item.text.unwrap_or_default(),
                                keep_with_next: item.keep_with_next.unwrap_or(true),
                                level: item.level.and_then(|v| u8::try_from(v).ok()).ok_or_else(
                                    || napi::Error::from_reason("Invalid heading level"),
                                )?,
                            })
                        }
                        "styled-paragraph"
                            if item.text.is_some()
                                && item.style.is_some()
                                && item.table.is_none() =>
                        {
                            Ok(PdfBlock::StyledParagraph {
                                text: item.text.unwrap_or_default(),
                                style: item.style.expect("style checked").into(),
                            })
                        }
                        "spacer"
                            if item.height.is_some()
                                && item.text.is_none()
                                && item.table.is_none() =>
                        {
                            Ok(PdfBlock::Spacer {
                                height: item.height.unwrap_or_default() as f32,
                            })
                        }
                        "table" if item.table.is_some() && item.text.is_none() => Ok(
                            PdfBlock::Table(to_table(item.table.expect("table checked"))),
                        ),
                        _ => Err(napi::Error::from_reason(
                            "Invalid flow block kind or payload",
                        )),
                    })
                    .collect::<napi::Result<Vec<_>>>()
            })
            .transpose()?,
    };
    Ok(doc)
}

/// Synchronous API: unchanged for existing callers.
#[allow(clippy::too_many_arguments)]
#[napi]
pub fn render_pdf_native(
    title: String,
    paragraphs: Vec<String>,
    rows: Vec<String>,
    font_data: Buffer,
    table: Option<NodeTable>,
    blocks: Option<Vec<NodeBlock>>,
    page: Option<NodePage>,
    font_faces: Option<Vec<NodeFontFace>>,
    chrome: Option<NodePageChrome>,
) -> napi::Result<Buffer> {
    let doc = parse_document(
        title, paragraphs, rows, table, blocks, page, font_faces, chrome,
    )?;
    vufra_pdf::render_pdf(&doc, font_data.as_ref(), RenderOptions::default())
        .map(Buffer::from)
        .map_err(|error| napi::Error::from_reason(error.to_string()))
}

/// Cancellation flag remains accessible from the Node event loop while the worker runs.
#[napi]
pub struct PdfCancellationToken {
    cancelled: Arc<AtomicBool>,
}
impl Default for PdfCancellationToken {
    fn default() -> Self {
        Self::new()
    }
}
#[napi]
impl PdfCancellationToken {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }
    #[napi]
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
    #[napi(getter)]
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }
}

#[napi(object)]
pub struct NativePdfResult {
    pub pdf: Buffer,
    pub render_ms: f64,
}

/// Owned input, moved off the JS thread before CPU-heavy layout and rendering.
pub struct PdfRenderTask {
    doc: PdfDocument,
    font_data: Vec<u8>,
    cancelled: Arc<AtomicBool>,
}
impl Task for PdfRenderTask {
    type Output = (Vec<u8>, f64);
    type JsValue = NativePdfResult;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let started = Instant::now();
        let bytes = vufra_pdf::render_pdf_with_cancel(
            &self.doc,
            &self.font_data,
            RenderOptions::default(),
            &self.cancelled,
        )
        .map_err(|error| napi::Error::from_reason(error.to_string()))?;
        Ok((bytes, started.elapsed().as_secs_f64() * 1000.0))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(NativePdfResult {
            pdf: Buffer::from(output.0),
            render_ms: output.1,
        })
    }
}

/// Queued using N-API/libuv async work. No Tokio runtime or JS event-loop CPU rendering.
// Preserve the positional binding ABI: the eighth argument is the cancellation token.
#[allow(clippy::too_many_arguments)]
#[napi]
pub fn render_pdf_async_native(
    title: String,
    paragraphs: Vec<String>,
    rows: Vec<String>,
    font_data: Buffer,
    table: Option<NodeTable>,
    blocks: Option<Vec<NodeBlock>>,
    page: Option<NodePage>,
    token: Option<&PdfCancellationToken>,
    font_faces: Option<Vec<NodeFontFace>>,
    chrome: Option<NodePageChrome>,
) -> napi::Result<AsyncTask<PdfRenderTask>> {
    let doc = parse_document(
        title, paragraphs, rows, table, blocks, page, font_faces, chrome,
    )?;
    Ok(AsyncTask::new(PdfRenderTask {
        doc,
        font_data: font_data.to_vec(),
        cancelled: token.map_or_else(|| Arc::new(AtomicBool::new(false)), |t| t.cancelled.clone()),
    }))
}
