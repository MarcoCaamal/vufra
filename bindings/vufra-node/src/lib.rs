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
    GraphicKind, ImageFit, MAX_IMAGE_BLOCKS, MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES, PageGeometry,
    PdfBlock, PdfColumn, PdfDocument, PdfGraphic, PdfImage, PdfTable, RenderOptions, TextStyle,
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
    pub table: Option<NodeTable>,
    pub image: Option<NodeImage>,
    pub items: Option<Vec<String>>,
    pub ordered: Option<bool>,
    pub keep_with_next: Option<bool>,
    pub graphic: Option<NodeGraphic>,
    pub level: Option<u32>,
    pub style: Option<NodeTextStyle>,
    pub height: Option<f64>,
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

fn parse_document(
    title: String,
    paragraphs: Vec<String>,
    rows: Vec<String>,
    table: Option<NodeTable>,
    blocks: Option<Vec<NodeBlock>>,
    page: Option<NodePage>,
) -> napi::Result<PdfDocument> {
    // Reject oversized images before copying JS buffers into Rust jobs.
    if let Some(items) = &blocks {
        let images: Vec<_> = items
            .iter()
            .filter_map(|item| item.image.as_ref())
            .collect();
        if images.len() > MAX_IMAGE_BLOCKS
            || images
                .iter()
                .try_fold(0usize, |sum, img| sum.checked_add(img.data.len()))
                .is_none_or(|len| len > MAX_TOTAL_IMAGE_BYTES)
        {
            return Err(napi::Error::from_reason(
                "too many images or too much image data",
            ));
        }
    }
    let doc = PdfDocument {
        title,
        paragraphs,
        rows,
        table: table.map(to_table),
        page: page.map(Into::into),
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

/// Synchronous API: unchanged, useful for simple scripts and worker threads.
#[napi]
pub fn render_pdf_native(
    title: String,
    paragraphs: Vec<String>,
    rows: Vec<String>,
    font_data: Buffer,
    table: Option<NodeTable>,
    blocks: Option<Vec<NodeBlock>>,
    page: Option<NodePage>,
) -> napi::Result<Buffer> {
    let doc = parse_document(title, paragraphs, rows, table, blocks, page)?;
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
) -> napi::Result<AsyncTask<PdfRenderTask>> {
    let doc = parse_document(title, paragraphs, rows, table, blocks, page)?;
    Ok(AsyncTask::new(PdfRenderTask {
        doc,
        font_data: font_data.to_vec(),
        cancelled: token.map_or_else(|| Arc::new(AtomicBool::new(false)), |t| t.cancelled.clone()),
    }))
}
