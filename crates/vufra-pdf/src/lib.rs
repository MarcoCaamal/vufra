//! Experimental high-level Vufra PDF renderer. API may change until v1.
//! Input is semantic text and rows; the supplied font is embedded in the output.
//! Current shaping/rendering path is validated for Latin text, not bidi or fallback.

use parley::{
    Alignment, AlignmentOptions, FontContext, FontFamily, FontFamilyName, Layout, LayoutContext,
    StyleProperty,
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
pub use box_layout::{BoxAlign, CellBorder, PdfBox, PdfBoxItem, PdfBoxTable, TableRowSpan};
pub use graphic::{GraphicKind, PdfGraphic};
pub use page_chrome::PdfPageChrome;
#[derive(Debug, Clone)]
pub struct PdfPageMaster {
    /// First canonical body block on the section's starting page.
    pub start_block: usize,
    pub chrome: PdfPageChrome,
}
pub use rich_text::{PdfFontFace, PdfTextRun};
pub use row::{CellPadding, CellVerticalAlign, PdfRow, PdfRowColumn, PdfRowItem, TableCellLayout};
pub use semantic::{ContentColumn, ContentFrame, ContentNode, SemanticDocument, TextPresentation};
mod style;
pub use image::{ImageFit, MAX_IMAGE_BLOCKS, MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES, PdfImage};
pub use style::{PageGeometry, TextStyle};

/// An ordered document block. Tables and paragraphs may share pages.
#[derive(Debug, Clone)]
pub enum PdfBlock {
    Paragraph(String),
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
    /// Page-resolved entry: validated label and block target, rendered after pagination.
    PageReference {
        label: String,
        target_block: usize,
    },
    RichParagraph {
        runs: Vec<PdfTextRun>,
        style: TextStyle,
        keep_with_next: bool,
    },
}
use vufra_layout::PaginationError;

const MAX_FONT_BYTES: usize = 20 * 1024 * 1024;
const MAX_TOTAL_TEXT_BYTES: usize = 4 * 1024 * 1024;

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

/// Single Rust render entry; the authored SemanticDocument owns its tree.
/// Cancellation is passed through from NAPI to the same native renderer.
pub fn render_semantic_pdf(
    document: SemanticDocument,
    font_bytes: Arc<Vec<u8>>,
    options: RenderOptions,
) -> Result<Vec<u8>, RenderError> {
    render_semantic_pdf_with_cancel(document, font_bytes, options, &NEVER_CANCELLED)
}

pub fn render_semantic_pdf_with_cancel(
    document: SemanticDocument,
    font_bytes: Arc<Vec<u8>>,
    options: RenderOptions,
    cancel: &AtomicBool,
) -> Result<Vec<u8>, RenderError> {
    check_cancel(cancel)?;
    if document.title.trim().is_empty() || document.title.contains(char::from(0)) {
        return Err(RenderError::InvalidInput("title must be nonempty"));
    }
    if font_bytes.is_empty() || font_bytes.len() > MAX_FONT_BYTES {
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
    let SemanticDocument {
        title,
        nodes,
        page,
        fonts,
        chrome,
        page_masters,
    } = document;
    flow_render::render_semantic_flow(
        &title,
        nodes,
        font_bytes,
        options,
        page.unwrap_or_default(),
        fonts,
        chrome.as_ref(),
        &page_masters,
        cancel,
    )
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
    #[test]
    fn semantic_input_rejects_invalid_title_font_and_options() {
        let doc = SemanticDocument::new("");
        assert!(matches!(
            render_semantic_pdf(doc, Arc::new(vec![1]), RenderOptions::default()),
            Err(RenderError::InvalidInput(_))
        ));
        assert!(matches!(
            render_semantic_pdf(
                SemanticDocument::new("Test"),
                Arc::new(vec![]),
                RenderOptions::default()
            ),
            Err(RenderError::InvalidFont)
        ));
        assert!(matches!(
            render_semantic_pdf(
                SemanticDocument::new("Test"),
                Arc::new(vec![1]),
                RenderOptions {
                    text_size: f32::NAN,
                    ..RenderOptions::default()
                }
            ),
            Err(RenderError::InvalidInput(_))
        ));
    }
    #[test]
    fn cancellation_precedes_font_parsing() {
        let signal = AtomicBool::new(true);
        let doc = SemanticDocument::new("Cancelable");
        assert!(matches!(
            render_semantic_pdf_with_cancel(
                doc,
                Arc::new(vec![0, 1, 2]),
                RenderOptions::default(),
                &signal
            ),
            Err(RenderError::Cancelled)
        ));
    }
}
