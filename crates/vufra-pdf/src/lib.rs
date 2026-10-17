//! Experimental high-level Vufra PDF renderer. API may change until v1.
//! Input is semantic text and rows; the supplied font is embedded in the output.
//! Current shaping/rendering path is validated for Latin text, not bidi or fallback.

use krilla::{
    Document as KrillaDocument,
    geom::Point,
    page::PageSettings,
    text::{Font, TextDirection},
};
use parley::{
    Alignment, AlignmentOptions, FontContext, FontFamily, FontFamilyName, Layout, LayoutContext,
    StyleProperty,
    fontique::{Blob, Collection, CollectionOptions, SourceCache},
};
use std::{
    borrow::Cow,
    error::Error,
    fmt,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
static NEVER_CANCELLED: AtomicBool = AtomicBool::new(false);
pub(crate) fn check_cancel(cancel: &AtomicBool) -> Result<(), RenderError> {
    if cancel.load(Ordering::Relaxed) {
        Err(RenderError::Cancelled)
    } else {
        Ok(())
    }
}
mod box_layout;
mod flow_render;
mod graphic;
mod image;
mod page_chrome;
mod rich_text;
mod row;
mod semantic;
pub use box_layout::{BoxAlign, PdfBox, PdfBoxItem, PdfBoxTable};
pub use graphic::{GraphicKind, PdfGraphic};
pub use page_chrome::PdfPageChrome;
pub use rich_text::{PdfFontFace, PdfTextRun};
pub use row::{PdfRow, PdfRowColumn, PdfRowItem};
pub use semantic::{
    ContentColumn, ContentFrame, ContentNode, ContentTableColumn, SemanticDocument,
    TextPresentation,
};
mod style;
pub use image::{ImageFit, MAX_IMAGE_BLOCKS, MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES, PdfImage};
mod table;
pub use style::{PageGeometry, TextStyle};
pub use table::{PdfColumn, PdfTable};

/// An ordered document block. Tables and paragraphs may share pages.
#[derive(Debug, Clone)]
pub enum PdfBlock {
    Paragraph(String),
    Table(PdfTable),
    Heading {
        text: String,
        level: u8,
        keep_with_next: bool,
    },
    StyledParagraph {
        text: String,
        style: TextStyle,
    },
    Spacer {
        height: f32,
    },
    Image(PdfImage),
    List {
        items: Vec<String>,
        ordered: bool,
    },
    Graphic(PdfGraphic),
    Row(PdfRow),
    Box(PdfBox),
    PageBreak,
    RichParagraph {
        runs: Vec<PdfTextRun>,
        style: TextStyle,
        keep_with_next: bool,
    },
}
use table::{draw_table_fragment, prepare_table};
use vufra_core::TableRow;
use vufra_layout::{PaginationError, paginate_all};

const PAGE_WIDTH: f32 = 595.0;
const PAGE_HEIGHT: f32 = 842.0;
const LEFT: f32 = 49.0;
const CONTENT_WIDTH: f32 = PAGE_WIDTH - 2.0 * LEFT;
const TEXT_TOP: f32 = 120.0;
const CONTENT_HEIGHT: f32 = 650.0;
const MAX_FONT_BYTES: usize = 20 * 1024 * 1024;
const MAX_ROWS: usize = 10_000;
const MAX_PARAGRAPHS: usize = 1000;
const MAX_TOTAL_TEXT_BYTES: usize = 4 * 1024 * 1024;

/// Document input: legacy paragraphs/rows/table OR ordered `blocks` mode.
/// The new flow mode can split long paragraphs and multi-column table rows.
#[derive(Debug, Clone, Default)]
pub struct PdfDocument {
    pub title: String,
    pub paragraphs: Vec<String>,
    pub rows: Vec<String>,
    /// A genuine multi-column table, rendered on its own page(s) after paragraphs/rows.
    pub table: Option<PdfTable>,
    /// Ordered content mode. Cannot be combined with legacy paragraphs/rows/table.
    pub blocks: Option<Vec<PdfBlock>>,
    /// Page geometry applies to the ordered `blocks` mode only.
    pub page: Option<PageGeometry>,
    /// Additional named fonts for rich text blocks; regular font is supplied separately.
    pub fonts: Vec<PdfFontFace>,
    /// Optional reusable page bands; absent retains historical heading/footer.
    pub chrome: Option<PdfPageChrome>,
}

/// Render settings. Defaults are chosen for an A4 document.
#[derive(Debug, Clone, Copy)]
pub struct RenderOptions {
    pub text_size: f32,
    pub line_height: f32,
}
impl Default for RenderOptions {
    fn default() -> Self {
        Self {
            text_size: 11.0,
            line_height: 16.0,
        }
    }
}

/// Error without process crashes on invalid user input.
#[derive(Debug)]
pub enum RenderError {
    InvalidInput(&'static str),
    InvalidFont,
    InvalidLayout(PaginationError),
    InvalidPdf(String),
    Cancelled,
}
impl fmt::Display for RenderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput(message) => write!(f, "Invalid document: {message}"),
            Self::InvalidFont => write!(f, "Font is missing, oversized, or unsupported"),
            Self::InvalidLayout(error) => write!(f, "Document pagination failed: {error}"),
            Self::InvalidPdf(error) => write!(f, "PDF generation failed: {error}"),
            Self::Cancelled => write!(f, "VUFRA_CANCELLED: PDF rendering cancelled"),
        }
    }
}
impl Error for RenderError {}

struct PreparedEntry {
    lines: Vec<String>,
    height: f32,
    is_row: bool,
}

fn validate(
    document: &PdfDocument,
    font_bytes: &[u8],
    options: RenderOptions,
) -> Result<(), RenderError> {
    if document.title.trim().is_empty() {
        return Err(RenderError::InvalidInput("title must be nonempty"));
    }
    if document.paragraphs.len() > MAX_PARAGRAPHS || document.rows.len() > MAX_ROWS {
        return Err(RenderError::InvalidInput("too many paragraphs or rows"));
    }
    if font_bytes.len() > MAX_FONT_BYTES || font_bytes.is_empty() {
        return Err(RenderError::InvalidFont);
    }
    if !options.text_size.is_finite()
        || !options.line_height.is_finite()
        || !(6.0..=24.0).contains(&options.text_size)
        || !(10.0..=48.0).contains(&options.line_height)
        || options.line_height < options.text_size
    {
        return Err(RenderError::InvalidInput(
            "text size or line height outside accepted range",
        ));
    }
    let total = document.paragraphs.iter().chain(&document.rows).try_fold(
        document.title.len(),
        |sum, item| {
            sum.checked_add(item.len())
                .ok_or(RenderError::InvalidInput("text too large"))
        },
    )?;
    if total > MAX_TOTAL_TEXT_BYTES {
        return Err(RenderError::InvalidInput("text too large"));
    }
    if document.title.chars().any(|ch| ch == '\0') {
        return Err(RenderError::InvalidInput("title contains null byte"));
    }
    Ok(())
}

/// Generate full PDF bytes in memory; there is no filesystem access in this API.
/// Supply the actual TTF/OTF bytes to guarantee that the font can be embedded.
pub fn render_pdf(
    document: &PdfDocument,
    font_bytes: &[u8],
    options: RenderOptions,
) -> Result<Vec<u8>, RenderError> {
    render_pdf_with_cancel(document, font_bytes, options, &NEVER_CANCELLED)
}

/// Render directly from the owned recursive semantic AST. Legacy PdfBlock,
/// PdfBoxItem and PdfRowItem remain supported as interoperability adapters.
pub fn render_semantic_pdf(
    document: &SemanticDocument,
    font_bytes: &[u8],
    options: RenderOptions,
) -> Result<Vec<u8>, RenderError> {
    // Same validation of public RenderOptions as the legacy entry.
    validate(
        &PdfDocument {
            title: document.title.clone(),
            ..PdfDocument::default()
        },
        font_bytes,
        options,
    )?;
    flow_render::render_semantic_flow(
        &document.title,
        &document.nodes,
        font_bytes,
        options,
        document.page.unwrap_or_default(),
        &document.fonts,
        document.chrome.as_ref(),
        &NEVER_CANCELLED,
    )
}

/// Cooperative cancellation at text, cell, and page boundaries.
pub fn render_pdf_with_cancel(
    document: &PdfDocument,
    font_bytes: &[u8],
    options: RenderOptions,
    cancel: &AtomicBool,
) -> Result<Vec<u8>, RenderError> {
    check_cancel(cancel)?;
    validate(document, font_bytes, options)?;
    if document.chrome.is_some() && document.blocks.is_none() {
        return Err(RenderError::InvalidInput(
            "page chrome requires blocks mode",
        ));
    }
    if document.blocks.is_none() && document.page.is_some() {
        return Err(RenderError::InvalidInput(
            "page geometry requires blocks mode",
        ));
    }
    if let Some(blocks) = &document.blocks {
        if !document.paragraphs.is_empty() || !document.rows.is_empty() || document.table.is_some()
        {
            return Err(RenderError::InvalidInput(
                "blocks cannot be combined with legacy paragraphs/rows/table",
            ));
        }
        return flow_render::render_flow(
            &document.title,
            blocks,
            font_bytes,
            options,
            document.page.unwrap_or_default(),
            &document.fonts,
            document.chrome.as_ref(),
            cancel,
        );
    }
    let font = Font::new(font_bytes.to_vec().into(), 0).ok_or(RenderError::InvalidFont)?;
    // No host/system font substitution in measurements. Only the embedded input
    // font participates in layout; unsupported scripts are a documented limitation.
    let mut font_context = FontContext {
        collection: Collection::new(CollectionOptions {
            shared: false,
            system_fonts: false,
        }),
        source_cache: SourceCache::default(),
    };
    let registered = font_context
        .collection
        .register_fonts(Blob::new(Arc::new(font_bytes.to_vec())), None);
    let family_id = registered.first().ok_or(RenderError::InvalidFont)?.0;
    let family = font_context
        .collection
        .family_name(family_id)
        .ok_or(RenderError::InvalidFont)?
        .to_string();
    let mut layout_context: LayoutContext<()> = LayoutContext::new();
    // The current header is a single line. Do not draw off the A4 page.
    let mut title_builder =
        layout_context.ranged_builder(&mut font_context, &document.title, 1.0, false);
    title_builder.push_default(StyleProperty::FontSize(18.0));
    title_builder.push_default(StyleProperty::FontFamily(FontFamily::Single(
        FontFamilyName::Named(Cow::Owned(family.clone())),
    )));
    let mut title_layout: Layout<()> = title_builder.build(&document.title);
    title_layout.break_all_lines(None);
    if title_layout.width() > CONTENT_WIDTH {
        return Err(RenderError::InvalidInput("title exceeds printable width"));
    }
    let mut prepared = Vec::with_capacity(document.paragraphs.len() + document.rows.len());
    for paragraph in &document.paragraphs {
        check_cancel(cancel)?;
        prepared.push(prepare(
            paragraph,
            false,
            &family,
            &mut font_context,
            &mut layout_context,
            options,
            cancel,
        )?);
    }
    for (index, row) in document.rows.iter().enumerate() {
        check_cancel(cancel)?;
        let text = format!("{:04}  |  {row}", index + 1);
        prepared.push(prepare(
            &text,
            true,
            &family,
            &mut font_context,
            &mut layout_context,
            options,
            cancel,
        )?);
    }
    let layout_rows = prepared
        .iter()
        .map(|item| TableRow::new("rendered text block", item.height))
        .collect::<Vec<_>>();
    let pages = if layout_rows.is_empty() && document.table.is_some() {
        Vec::new()
    } else {
        paginate_all(&layout_rows, CONTENT_HEIGHT, 0.0).map_err(RenderError::InvalidLayout)?
    };
    let prepared_table = document
        .table
        .as_ref()
        .map(|table| {
            prepare_table(
                table,
                &family,
                &mut font_context,
                &mut layout_context,
                options,
                (CONTENT_WIDTH, CONTENT_HEIGHT),
                cancel,
            )
        })
        .transpose()?;
    let page_count = pages.len() + prepared_table.as_ref().map_or(0, |t| t.pages.len());

    let mut output = KrillaDocument::new();
    for (page_index, page_data) in pages.iter().enumerate() {
        check_cancel(cancel)?;
        let settings = PageSettings::from_wh(PAGE_WIDTH, PAGE_HEIGHT)
            .ok_or(RenderError::InvalidInput("invalid paper size"))?;
        let mut page = output.start_page_with(settings);
        let mut surface = page.surface();
        // Headers and footers are reserved outside body: [120, 770].
        surface.draw_text(
            Point::from_xy(LEFT, 51.0),
            font.clone(),
            18.0,
            &document.title,
            false,
            TextDirection::Auto,
        );
        surface.draw_text(
            Point::from_xy(LEFT, 87.0),
            font.clone(),
            10.0,
            "Vufra • Documento generado desde Rust",
            false,
            TextDirection::Auto,
        );
        surface.draw_text(
            Point::from_xy(LEFT, 812.0),
            font.clone(),
            10.0,
            &format!("Página {} / {}", page_index + 1, page_count),
            false,
            TextDirection::Auto,
        );
        let mut y = TEXT_TOP;
        for entry in &prepared[page_data.start_row..page_data.end_row] {
            check_cancel(cancel)?;
            for line in &entry.lines {
                if !line.is_empty() {
                    surface.draw_text(
                        Point::from_xy(LEFT, y),
                        font.clone(),
                        options.text_size,
                        line,
                        false,
                        TextDirection::Auto,
                    );
                }
                y += options.line_height;
            }
            y += if entry.is_row { 4.0 } else { 9.0 };
        }
        surface.finish();
        page.finish();
    }
    if let Some(prepared_table) = prepared_table.as_ref() {
        for (index, fragment) in prepared_table.pages.iter().enumerate() {
            check_cancel(cancel)?;
            let settings = PageSettings::from_wh(PAGE_WIDTH, PAGE_HEIGHT)
                .ok_or(RenderError::InvalidInput("invalid paper size"))?;
            let mut page = output.start_page_with(settings);
            let mut surface = page.surface();
            surface.draw_text(
                Point::from_xy(LEFT, 51.0),
                font.clone(),
                18.0,
                &document.title,
                false,
                TextDirection::Auto,
            );
            surface.draw_text(
                Point::from_xy(LEFT, 87.0),
                font.clone(),
                10.0,
                "Vufra • Documento generado desde Rust",
                false,
                TextDirection::Auto,
            );
            surface.draw_text(
                Point::from_xy(LEFT, 812.0),
                font.clone(),
                10.0,
                &format!("Página {} / {}", pages.len() + index + 1, page_count),
                false,
                TextDirection::Auto,
            );
            draw_table_fragment(
                &mut surface,
                prepared_table,
                fragment,
                &font,
                options,
                TEXT_TOP,
                LEFT,
            );
            surface.finish();
            page.finish();
        }
    }
    check_cancel(cancel)?;
    output
        .finish()
        .map_err(|error| RenderError::InvalidPdf(format!("{error:?}")))
}

fn prepare(
    input: &str,
    is_row: bool,
    family: &str,
    fonts: &mut FontContext,
    context: &mut LayoutContext<()>,
    options: RenderOptions,
    cancel: &AtomicBool,
) -> Result<PreparedEntry, RenderError> {
    if input.contains('\0') {
        return Err(RenderError::InvalidInput("text contains null byte"));
    }
    let lines = measure_text_lines(
        input,
        CONTENT_WIDTH,
        family,
        fonts,
        context,
        options.text_size,
        cancel,
    )?;
    let height = lines.len() as f32 * options.line_height + if is_row { 4.0 } else { 9.0 };
    if height > CONTENT_HEIGHT {
        return Err(RenderError::InvalidInput(
            "paragraph or row exceeds one printable page",
        ));
    }
    Ok(PreparedEntry {
        lines,
        height,
        is_row,
    })
}

/// Text lines measured against a specific width and explicit caller-provided font.
pub(crate) fn measure_text_lines(
    input: &str,
    width: f32,
    family: &str,
    fonts: &mut FontContext,
    context: &mut LayoutContext<()>,
    font_size: f32,
    cancel: &AtomicBool,
) -> Result<Vec<String>, RenderError> {
    check_cancel(cancel)?;
    if input.contains('\0') {
        return Err(RenderError::InvalidInput("text contains null byte"));
    }
    let lines = if input.trim().is_empty() {
        vec![String::new()]
    } else {
        let mut builder = context.ranged_builder(fonts, input, 1.0, false);
        builder.push_default(StyleProperty::FontSize(font_size));
        builder.push_default(StyleProperty::FontFamily(FontFamily::Single(
            FontFamilyName::Named(Cow::Owned(family.to_string())),
        )));
        let mut layout: Layout<()> = builder.build(input);
        layout.break_all_lines(Some(width));
        layout.align(Alignment::Start, AlignmentOptions::default());
        // Parley may hang trailing whitespace beyond the line box; don't count
        // that against visible text width.
        if layout
            .lines()
            .any(|line| line.metrics().advance - line.metrics().hanging_advance > width + 0.5)
        {
            return Err(RenderError::InvalidInput(
                "unbreakable text exceeds printable width",
            ));
        }
        layout
            .lines()
            .map(|line| {
                input[line.text_range()]
                    .trim_end_matches(['\r', '\n'])
                    .to_string()
            })
            .collect::<Vec<_>>()
    };
    check_cancel(cancel)?;
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    #[test]
    fn rejects_invalid_inputs_without_panicking() {
        let f = &[1, 2, 3];
        let doc = PdfDocument::default();
        assert!(matches!(
            render_pdf(&doc, f, RenderOptions::default()),
            Err(RenderError::InvalidInput(_))
        ));
        let doc = PdfDocument {
            title: "Test".into(),
            ..Default::default()
        };
        assert!(matches!(
            render_pdf(&doc, f, RenderOptions::default()),
            Err(RenderError::InvalidFont)
        ));
        assert!(matches!(
            render_pdf(
                &doc,
                f,
                RenderOptions {
                    text_size: f32::NAN,
                    ..Default::default()
                }
            ),
            Err(RenderError::InvalidInput(_))
        ));
    }
    #[test]
    fn cancelled_before_render_returns_distinct_error_even_with_invalid_font() {
        let cancelled = AtomicBool::new(true);
        let doc = PdfDocument {
            title: "Cancelable".into(),
            ..Default::default()
        };
        let result = render_pdf_with_cancel(&doc, &[0, 1, 2], RenderOptions::default(), &cancelled);
        assert!(matches!(result, Err(RenderError::Cancelled)));
        assert!(
            RenderError::Cancelled
                .to_string()
                .contains("VUFRA_CANCELLED")
        );
    }
    #[test]
    fn rejects_excessive_row_counts() {
        let doc = PdfDocument {
            title: "Test".into(),
            rows: vec!["x".into(); 10001],
            paragraphs: vec![],
            table: None,
            blocks: None,
            page: None,
            fonts: vec![],
            chrome: None,
        };
        assert!(matches!(
            render_pdf(&doc, &[1], RenderOptions::default()),
            Err(RenderError::InvalidInput(_))
        ));
    }
}
